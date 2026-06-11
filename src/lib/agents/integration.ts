/**
 * Integration agent — the ONLY agent that calls external APIs
 * (Jira, Linear, Slack, Notion, Google Calendar). All other agents route
 * external writes through this one (guardrail #1).
 *
 * Error policy: 10s timeout on every call, structured logging, never
 * throws to the caller — failures return null/empty/zero.
 */

import "server-only";

import { getMeetingBotAdapter } from "@/lib/adapters/meetingbot";
import { getIntegration } from "@/lib/supabase/queries";
import { VENDOR_TIMEOUT_MS, logVendorError } from "@/lib/utils/errors";
import type { MeetingSummaryResult as MeetingSummary } from "@/types/meeting";
import type {
  CalendarMeeting,
  ExternalTicket,
  GoogleCalendarCredentials,
  JiraCredentials,
  LinearCredentials,
  LinkRef,
  SlackCredentials,
  TicketPlatform,
  TicketRef,
} from "@/types/integrations";
import { ingestTicket } from "./memory";

const TICKET_SYNC_WINDOW_DAYS = 90;

/** Derives labelled links from bare URLs (memory stores plain strings). */
export function toLinkRefs(urls: string[]): LinkRef[] {
  return urls.map((url) => {
    try {
      return { label: new URL(url).hostname, url };
    } catch {
      return { label: url, url };
    }
  });
}

/** Flattens a Jira ADF (Atlassian Document Format) node tree to plain text. */
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[] };
  const own = typeof n.text === "string" ? n.text : "";
  const children = Array.isArray(n.content)
    ? n.content.map(adfToText).filter(Boolean).join(" ")
    : "";
  return [own, children].filter(Boolean).join(" ");
}

export class IntegrationAgent {
  /**
   * Reads + parses provider credentials from the integrations table.
   * TODO(security): decrypt — v1 stores serialized JSON.
   */
  private async getCredentials<T>(
    orgId: string,
    provider: string,
  ): Promise<T | null> {
    try {
      const integration = await getIntegration(orgId, provider);
      if (!integration?.credentials_encrypted) return null;
      return JSON.parse(integration.credentials_encrypted) as T;
    } catch (error) {
      logVendorError("integration-agent", error, {
        orgId,
        provider,
        stage: "get-credentials",
      });
      return null;
    }
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    context: Record<string, unknown>,
  ): Promise<T | null> {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logVendorError("integration-agent", `HTTP ${res.status}`, {
        ...context,
        body: body.slice(0, 500),
      });
      return null;
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  // ── 1. postLinksToChat ─────────────────────────────────────────────────

  async postLinksToChat(botId: string, links: LinkRef[]): Promise<void> {
    if (!botId || links.length === 0) return;
    try {
      const message = `Related: ${links
        .map((link) => `[${link.label}](${link.url})`)
        .join(", ")}`;
      await getMeetingBotAdapter().sendChatMessage(botId, message);
    } catch (error) {
      logVendorError("integration-agent", error, {
        botId,
        stage: "post-links-to-chat",
      });
    }
  }

  // ── 2. postSummaryToSlack ──────────────────────────────────────────────

  async postSummaryToSlack(params: {
    orgId: string;
    summary: MeetingSummary;
    meetingTitle: string;
    meetingId: string;
  }): Promise<void> {
    try {
      const creds = await this.getCredentials<SlackCredentials>(
        params.orgId,
        "slack",
      );
      if (!creds?.webhook_url) {
        console.info(
          JSON.stringify({
            level: "info",
            agent: "integration",
            event: "slack_not_connected",
            orgId: params.orgId,
            meetingId: params.meetingId,
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      const { summary } = params;
      const blocks: unknown[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: params.meetingTitle.slice(0, 150),
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: summary.summary || "_No summary available._",
          },
        },
      ];

      if (summary.decisions.length > 0) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Decisions*\n${summary.decisions
              .map((d) => `• ${d.decision}${d.owner ? ` — ${d.owner}` : ""}`)
              .join("\n")}`,
          },
        });
      }

      if (summary.action_items.length > 0) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Action items*\n${summary.action_items
              .map(
                (a) =>
                  `• ${a.task}${a.assignee ? ` — ${a.assignee}` : ""}${a.due_date ? ` (due ${a.due_date})` : ""}`,
              )
              .join("\n")}`,
          },
        });
      }

      await this.fetchJson(
        creds.webhook_url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Meeting summary: ${params.meetingTitle}`,
            blocks,
          }),
        },
        { orgId: params.orgId, meetingId: params.meetingId, stage: "slack-post" },
      );
    } catch (error) {
      logVendorError("integration-agent", error, {
        orgId: params.orgId,
        meetingId: params.meetingId,
        stage: "post-summary-to-slack",
      });
    }
  }

  // ── 3. createTicketFromActionItem ──────────────────────────────────────

  async createTicketFromActionItem(params: {
    orgId: string;
    actionItem: { task: string; assignee: string | null };
    projectId: string;
    platform: TicketPlatform;
  }): Promise<TicketRef | null> {
    try {
      if (params.platform === "jira") {
        return await this.createJiraTicket(params);
      }
      return await this.createLinearTicket(params);
    } catch (error) {
      logVendorError("integration-agent", error, {
        orgId: params.orgId,
        platform: params.platform,
        stage: "create-ticket",
      });
      return null;
    }
  }

  private async createJiraTicket(params: {
    orgId: string;
    actionItem: { task: string; assignee: string | null };
    projectId: string;
  }): Promise<TicketRef | null> {
    const creds = await this.getCredentials<JiraCredentials>(
      params.orgId,
      "jira",
    );
    if (!creds) return null;

    // Jira assignee requires an accountId; we only have a display name, so
    // it goes into the description instead.
    const description = [
      "Created by Insider from a meeting action item.",
      params.actionItem.assignee
        ? `Assignee (from meeting): ${params.actionItem.assignee}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const data = await this.fetchJson<{ key: string }>(
      `${creds.base_url.replace(/\/$/, "")}/rest/api/3/issue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.api_token}`).toString("base64")}`,
        },
        body: JSON.stringify({
          fields: {
            project: { key: params.projectId },
            issuetype: { name: "Task" },
            summary: params.actionItem.task.slice(0, 255),
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: description }],
                },
              ],
            },
          },
        }),
      },
      { orgId: params.orgId, stage: "jira-create-issue" },
    );

    if (!data?.key) return null;
    return {
      ticketId: data.key,
      url: `${creds.base_url.replace(/\/$/, "")}/browse/${data.key}`,
    };
  }

  private async createLinearTicket(params: {
    orgId: string;
    actionItem: { task: string; assignee: string | null };
    projectId: string;
  }): Promise<TicketRef | null> {
    const creds = await this.getCredentials<LinearCredentials>(
      params.orgId,
      "linear",
    );
    if (!creds) return null;

    const description = [
      "Created by Insider from a meeting action item.",
      params.actionItem.assignee
        ? `Assignee (from meeting): ${params.actionItem.assignee}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const data = await this.fetchJson<{
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: { identifier: string; url: string };
        };
      };
    }>(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: creds.api_key,
        },
        body: JSON.stringify({
          query: `mutation IssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) { success issue { identifier url } }
          }`,
          variables: {
            input: {
              teamId: params.projectId,
              title: params.actionItem.task.slice(0, 255),
              description,
            },
          },
        }),
      },
      { orgId: params.orgId, stage: "linear-create-issue" },
    );

    const issue = data?.data?.issueCreate?.issue;
    if (!data?.data?.issueCreate?.success || !issue) return null;
    return { ticketId: issue.identifier, url: issue.url };
  }

  // ── 4. fetchCalendarMeetings ───────────────────────────────────────────

  async fetchCalendarMeetings(params: {
    orgId: string;
    userId: string;
    dateRange: { start: Date; end: Date };
  }): Promise<CalendarMeeting[]> {
    try {
      const creds = await this.getCredentials<GoogleCalendarCredentials>(
        params.orgId,
        "google_calendar",
      );
      if (!creds?.access_token) return [];

      const query = new URLSearchParams({
        timeMin: params.dateRange.start.toISOString(),
        timeMax: params.dateRange.end.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });

      interface GcalEvent {
        id: string;
        summary?: string;
        location?: string;
        hangoutLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        attendees?: { email?: string }[];
        conferenceData?: {
          entryPoints?: { entryPointType?: string; uri?: string }[];
        };
      }

      const data = await this.fetchJson<{ items?: GcalEvent[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${creds.access_token}` },
        },
        { orgId: params.orgId, userId: params.userId, stage: "gcal-events" },
      );

      return (data?.items ?? []).map((event) => {
        const videoEntry = event.conferenceData?.entryPoints?.find(
          (e) => e.entryPointType === "video" && e.uri,
        );
        const locationUrl = event.location?.startsWith("http")
          ? event.location
          : null;

        return {
          id: event.id,
          title: event.summary ?? "Untitled meeting",
          startTime: new Date(
            event.start?.dateTime ?? event.start?.date ?? Date.now(),
          ),
          endTime: new Date(
            event.end?.dateTime ?? event.end?.date ?? Date.now(),
          ),
          meetingUrl:
            videoEntry?.uri ?? event.hangoutLink ?? locationUrl ?? null,
          attendees: (event.attendees ?? [])
            .map((a) => a.email)
            .filter((email): email is string => Boolean(email)),
        };
      });
    } catch (error) {
      logVendorError("integration-agent", error, {
        orgId: params.orgId,
        userId: params.userId,
        stage: "fetch-calendar-meetings",
      });
      return [];
    }
  }

  // ── 5. syncTicketsToMemory ─────────────────────────────────────────────

  async syncTicketsToMemory(params: {
    orgId: string;
    teamId: string;
    platform: TicketPlatform;
    projectId: string;
  }): Promise<number> {
    try {
      const tickets =
        params.platform === "jira"
          ? await this.fetchResolvedJiraTickets(params.orgId, params.projectId)
          : await this.fetchResolvedLinearTickets(
              params.orgId,
              params.projectId,
            );

      let synced = 0;
      for (const ticket of tickets) {
        // ingestTicket handles its own errors — log-and-continue per ticket.
        await ingestTicket({
          orgId: params.orgId,
          teamId: params.teamId,
          ticket,
        });
        synced += 1;
      }
      return synced;
    } catch (error) {
      logVendorError("integration-agent", error, {
        orgId: params.orgId,
        platform: params.platform,
        stage: "sync-tickets-to-memory",
      });
      return 0;
    }
  }

  private async fetchResolvedJiraTickets(
    orgId: string,
    projectId: string,
  ): Promise<ExternalTicket[]> {
    const creds = await this.getCredentials<JiraCredentials>(orgId, "jira");
    if (!creds) return [];

    const baseUrl = creds.base_url.replace(/\/$/, "");
    const jql = `project = "${projectId}" AND statusCategory = Done AND resolved >= -${TICKET_SYNC_WINDOW_DAYS}d ORDER BY resolved DESC`;
    const query = new URLSearchParams({
      jql,
      maxResults: "50",
      fields: "summary,description,status,resolutiondate",
    });

    interface JiraIssue {
      key: string;
      fields: {
        summary?: string;
        description?: unknown;
        status?: { name?: string };
        resolutiondate?: string | null;
      };
    }

    const data = await this.fetchJson<{ issues?: JiraIssue[] }>(
      `${baseUrl}/rest/api/3/search?${query}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.api_token}`).toString("base64")}`,
        },
      },
      { orgId, stage: "jira-search" },
    );

    return (data?.issues ?? []).map((issue) => ({
      id: issue.key,
      title: issue.fields.summary ?? issue.key,
      description: adfToText(issue.fields.description),
      status: issue.fields.status?.name ?? "Done",
      resolvedAt: issue.fields.resolutiondate
        ? new Date(issue.fields.resolutiondate)
        : undefined,
      url: `${baseUrl}/browse/${issue.key}`,
    }));
  }

  private async fetchResolvedLinearTickets(
    orgId: string,
    projectId: string,
  ): Promise<ExternalTicket[]> {
    const creds = await this.getCredentials<LinearCredentials>(orgId, "linear");
    if (!creds) return [];

    const since = new Date(
      Date.now() - TICKET_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    interface LinearIssue {
      identifier: string;
      title: string;
      description?: string | null;
      url: string;
      completedAt?: string | null;
      state?: { name?: string };
    }

    const data = await this.fetchJson<{
      data?: { issues?: { nodes?: LinearIssue[] } };
    }>(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: creds.api_key,
        },
        body: JSON.stringify({
          query: `query ResolvedIssues($filter: IssueFilter) {
            issues(filter: $filter, first: 50) {
              nodes { identifier title description url completedAt state { name } }
            }
          }`,
          variables: {
            filter: {
              team: { id: { eq: projectId } },
              completedAt: { gt: since },
            },
          },
        }),
      },
      { orgId, stage: "linear-search" },
    );

    return (data?.data?.issues?.nodes ?? []).map((issue) => ({
      id: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      status: issue.state?.name ?? "Done",
      resolvedAt: issue.completedAt ? new Date(issue.completedAt) : undefined,
      url: issue.url,
    }));
  }
}

export const integrationAgent = new IntegrationAgent();
