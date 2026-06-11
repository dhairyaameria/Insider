import { format, startOfWeek } from "date-fns";
import Link from "next/link";
import { BotStatusBadge, type BotStatus } from "@/components/bot/BotStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureOrgUser } from "@/lib/provision";
import {
  countDecisionsSince,
  getBotSessionsForMeetings,
  getMeetingsByOrg,
  getMeetingsSince,
  getRecentDecisions,
  getTeamsByOrg,
} from "@/lib/supabase/queries";
import type { Meeting } from "@/lib/supabase/types";
import { formatRelative } from "@/lib/utils";

function botStatusForMeeting(meeting: Meeting): BotStatus {
  if (meeting.status === "completed") return "ended";
  if (meeting.status === "active") return meeting.bot_joined ? "listening" : "joining";
  return "scheduled";
}

function ritualLabel(ritual: string): string {
  return ritual.replace("_", " ");
}

const TABLE_COLS =
  "grid grid-cols-[minmax(0,1fr)_110px_150px_110px_130px_60px] items-center gap-4";

export default async function DashboardPage() {
  const user = await ensureOrgUser();

  if (!user?.org_id) {
    return (
      <div className="flex flex-col items-start gap-2 py-20">
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Insider</h1>
        <p className="text-sm text-muted-foreground">
          Your account isn&apos;t linked to an organization yet. Create or join
          one to start sending the bot to meetings.
        </p>
      </div>
    );
  }
  const orgId = user.org_id;

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const [meetingsThisWeek, recentMeetings, decisionsThisWeek, recentDecisions, teams] =
    await Promise.all([
      getMeetingsSince(orgId, weekStart.toISOString()),
      getMeetingsByOrg(orgId, 8),
      countDecisionsSince(orgId, weekStart.toISOString()),
      getRecentDecisions(orgId, 5),
      getTeamsByOrg(orgId),
    ]);

  const sessionMeetingIds = Array.from(
    new Set([...meetingsThisWeek, ...recentMeetings].map((m) => m.id)),
  );
  const botSessions = await getBotSessionsForMeetings(sessionMeetingIds);
  const issuesByMeeting = new Map(
    botSessions.map((s) => [
      s.meeting_id,
      Array.isArray(s.issues_surfaced) ? s.issues_surfaced.length : 0,
    ]),
  );
  const issuesThisWeek = meetingsThisWeek.reduce(
    (sum, m) => sum + (issuesByMeeting.get(m.id) ?? 0),
    0,
  );
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const stats = [
    { label: "Meetings this week", value: meetingsThisWeek.length },
    { label: "Issues surfaced", value: issuesThisWeek },
    { label: "Decisions logged", value: decisionsThisWeek },
  ];

  return (
    <div className="space-y-8">
      {/* a. Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">This week</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {format(weekStart, "MMM d")} – {format(now, "MMM d, yyyy")}
        </p>
      </div>

      {/* b. Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-3xl font-semibold tabular-nums">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* c. Recent meetings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent meetings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentMeetings.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No meetings yet. Schedule the bot for your next standup to get
              started.
            </p>
          ) : (
            <div>
              <div
                className={`${TABLE_COLS} border-b px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground`}
              >
                <span>Title</span>
                <span>Team</span>
                <span>Date</span>
                <span>Ritual</span>
                <span>Bot</span>
                <span className="text-right">Issues</span>
              </div>
              {recentMeetings.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className={`${TABLE_COLS} border-b px-6 py-3 text-sm transition-colors last:border-0 hover:bg-accent/50`}
                >
                  <span className="truncate font-medium">
                    {meeting.title ?? "Untitled meeting"}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {(meeting.team_id && teamNameById.get(meeting.team_id)) ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {format(
                      new Date(meeting.started_at ?? meeting.created_at),
                      "MMM d, h:mm a",
                    )}
                  </span>
                  <span>
                    <Badge variant="outline" className="font-normal capitalize">
                      {ritualLabel(meeting.ritual_type)}
                    </Badge>
                  </span>
                  <span>
                    <BotStatusBadge status={botStatusForMeeting(meeting)} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {issuesByMeeting.get(meeting.id) ?? 0}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* d. Recent decisions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent decisions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentDecisions.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No decisions logged yet. They&apos;ll appear here after the bot
              attends meetings.
            </p>
          ) : (
            <ul>
              {recentDecisions.map((decision) => (
                <li
                  key={decision.id}
                  className="border-b px-6 py-4 last:border-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {decision.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {decision.body}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(decision.created_at)}
                    </span>
                  </div>
                  {decision.source_type === "meeting" && decision.source_id && (
                    <Link
                      href={`/meetings/${decision.source_id}`}
                      className="mt-1.5 inline-block text-xs font-medium text-brand-accent hover:underline"
                    >
                      View meeting →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
