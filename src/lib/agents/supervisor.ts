/**
 * Supervisor agent — the orchestrator.
 *
 * Sits between agents and enforces guardrails. v1 is a stateless routing
 * layer; v2 grows into a Claude tool-calling loop.
 *
 * Guardrails enforced here:
 * - never raise hand twice for the same/similar issue in one meeting
 * - 30s minimum between hand raises
 * - never surface stale resolutions (>180 days)
 * - similarity threshold 0.78
 * - graceful fallback: vendor failures log and leave the meeting running
 */

import "server-only";

import { getMeetingBotAdapter } from "@/lib/adapters/meetingbot";
import { getPipecatAdapter } from "@/lib/adapters/pipecat";
import {
  getMeeting,
  getMeetingChunks,
  saveMeetingSummary,
} from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";
import { summarySimilarity } from "@/lib/utils/text";
import type { BotSessionState } from "@/types/meeting";
import type { MemoryMatch } from "@/types/memory";
import { integrationAgent, toLinkRefs } from "./integration";
// Type-only import: keeps meeting.ts -> supervisor.ts the sole value edge
// (no circular runtime dependency).
import type { MeetingSession } from "./meeting";
import { ingestMeeting } from "./memory";

const MIN_MATCH_SIMILARITY = 0.78;
const DUPLICATE_ISSUE_SIMILARITY = 0.85;
const HAND_RAISE_COOLDOWN_MS = 30_000;
const STALE_RESOLUTION_MS = 180 * 24 * 60 * 60 * 1000;

const HAND_RAISE_CHAT_MESSAGE =
  "✋ Insider has a relevant note — finishing this thought first";

function logEvent(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: "info",
      agent: "supervisor",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

export class SupervisorAgent {
  /**
   * The guardrail gate. Pure and synchronous — returns false if speaking
   * now would violate any rule.
   */
  shouldRaiseHand(params: {
    meetingId: string;
    problemSummary: string;
    match: MemoryMatch;
    sessionState: BotSessionState;
  }): boolean {
    const { match, sessionState, problemSummary } = params;

    if (match.similarity < MIN_MATCH_SIMILARITY) return false;

    // Deduplicate: same issue id, or near-identical problem summary.
    const duplicate = sessionState.issuesSurfaced.some(
      (issue) =>
        issue.issueId === match.id ||
        summarySimilarity(issue.problemSummary, problemSummary) >
          DUPLICATE_ISSUE_SIMILARITY,
    );
    if (duplicate) return false;

    if (
      sessionState.handRaisedAt &&
      Date.now() - new Date(sessionState.handRaisedAt).getTime() <
        HAND_RAISE_COOLDOWN_MS
    ) {
      return false;
    }

    if (Date.now() - match.resolvedAt.getTime() > STALE_RESOLUTION_MS) {
      return false;
    }

    return true;
  }

  /**
   * Full raise-hand-and-speak flow for a freshly detected problem match.
   */
  async handleProblemMatch(params: {
    meetingId: string;
    botId: string;
    pipecatBotId: string;
    problemSummary: string;
    match: MemoryMatch;
    session: MeetingSession;
  }): Promise<void> {
    const { meetingId, botId, pipecatBotId, problemSummary, match, session } =
      params;

    try {
      // a. Guardrail gate.
      if (
        !this.shouldRaiseHand({
          meetingId,
          problemSummary,
          match,
          sessionState: session.getSessionState(),
        })
      ) {
        return;
      }

      // b. Record the raise in session state (synced to Redis + Postgres).
      session.recordHandRaised(match.id, problemSummary);

      // c. Platform-agnostic signal: chat message, not a UI hand-raise.
      try {
        await getMeetingBotAdapter().sendChatMessage(
          botId,
          HAND_RAISE_CHAT_MESSAGE,
        );
      } catch (error) {
        // If chat fails the bot can still speak — log and continue.
        logVendorError("supervisor", error, { meetingId, stage: "chat-signal" });
      }

      // d. Compose the 1-2 sentence response.
      const { text, links } = await session.onReadyToSpeak();

      // e. Pipecat synthesises via ElevenLabs and injects at next VAD pause.
      await getPipecatAdapter().triggerSpeak(pipecatBotId, text);

      // f. Log the spoken turn.
      logEvent("spoke", {
        meetingId,
        matchId: match.id,
        similarity: match.similarity,
        text,
      });

      // g. Stamp last_spoke_at + spoken text, keep links for the follow-up.
      session.markSpoke(links, text);
    } catch (error) {
      // Graceful fallback: the meeting continues, the bot stays silent.
      logVendorError("supervisor", error, {
        meetingId,
        stage: "handle-problem-match",
      });
    }
  }

  /**
   * The host called on the bot: speak the pending match now and follow up
   * with links in chat.
   */
  async handleReadyToSpeak(params: {
    meetingId: string;
    botId: string;
    pipecatBotId: string;
    session: MeetingSession;
  }): Promise<void> {
    const { meetingId, botId, pipecatBotId, session } = params;

    try {
      // a. Compose from the pending match.
      const { text, links } = await session.onReadyToSpeak();

      // b. Pipecat handles ElevenLabs TTS + audio injection — no audio here.
      await getPipecatAdapter().triggerSpeak(pipecatBotId, text);

      // c. Stamp last_spoke_at + spoken text (clears the pending match).
      session.markSpoke(links, text);

      // d. Links go through the Integration agent (guardrail #1).
      await integrationAgent.postLinksToChat(botId, toLinkRefs(links));

      // e. Log.
      logEvent("spoke", { meetingId, text });
    } catch (error) {
      logVendorError("supervisor", error, {
        meetingId,
        stage: "handle-ready-to-speak",
      });
    }
  }

  /**
   * Meeting ended: extract the summary, persist it, notify Slack, and kick
   * off memory ingestion without blocking the caller (guardrail #10).
   */
  async handleMeetingEnd(params: {
    meetingId: string;
    session: MeetingSession;
    orgId: string;
    teamId: string | null;
  }): Promise<void> {
    const { meetingId, session, orgId, teamId } = params;

    try {
      // a. Stop the session and extract the structured summary.
      //    endSession() also removes the session from the registry (e).
      const summary = await session.endSession();

      // b. Persist to meeting_summaries.
      await saveMeetingSummary({
        meeting_id: meetingId,
        summary_text: summary.summary,
        decisions: summary.decisions,
        action_items: summary.action_items,
        risks: summary.risks,
      });

      // c. Slack notification via the Integration agent.
      const meeting = await getMeeting(meetingId);
      await integrationAgent.postSummaryToSlack({
        orgId,
        summary,
        meetingTitle: meeting?.title ?? "Untitled meeting",
        meetingId,
      });

      // d. Memory ingestion — non-blocking, errors handled inside the
      //    memory agent. Rebuilds the raw transcript from the live chunks
      //    (embedding IS NULL) so re-ingestion never compounds embedded
      //    segments back into new chunks.
      const chunks = await getMeetingChunks(meetingId);
      const transcript = chunks
        .filter((c) => c.embedding === null)
        .map((c) => `${c.speaker_label ?? "unknown"}: ${c.text}`)
        .join("\n");

      void ingestMeeting({ meetingId, orgId, teamId, transcript, summary });

      logEvent("meeting_ended", { meetingId, decisions: summary.decisions.length });
    } catch (error) {
      logVendorError("supervisor", error, {
        meetingId,
        stage: "handle-meeting-end",
      });
    }
  }
}

export const supervisor = new SupervisorAgent();
