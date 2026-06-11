import type { ProblemType } from "@/lib/prompts/classify-problem";
import type { ExtractDecisionsResult } from "@/lib/prompts/extract-decisions";

/** Meeting ritual, detected from the meeting title / calendar metadata. */
export type RitualType = "standup" | "planning" | "incident_review" | "general";

/** A final transcript chunk flowing through the live pipeline. */
export interface TranscriptChunk {
  meetingId: string;
  text: string;
  speakerLabel: string;
  /** ISO 8601 */
  timestamp: string;
}

/** An issue the bot has already surfaced in this meeting session. */
export interface SurfacedIssueRecord {
  issueId: string;
  problemSummary: string;
  surfacedAt: string;
  /** Title of the matched past issue. */
  title?: string | null;
  /** Cosine similarity of the match at raise time. */
  similarity?: number | null;
  /** ISO 8601 — when the matched issue was resolved. */
  resolvedAt?: string | null;
  /** Links attached to the matched issue. */
  links?: string[];
  /** What the bot actually said, stamped after the spoken turn. */
  spokenText?: string | null;
}

/** A memory match waiting for the Supervisor's decision / a free slot to speak. */
export interface PendingMatch {
  problemSummary: string;
  problemType: ProblemType;
  issueId: string;
  title: string;
  resolution: string;
  resolvedAt: string;
  links: string[];
  similarity: number;
  queuedAt: string;
}

/** Live bot session state — held in memory, synced to Redis, mirrored to Postgres. */
export interface BotSessionState {
  issuesSurfaced: SurfacedIssueRecord[];
  handRaisedAt: string | null;
  lastSpokeAt: string | null;
  pendingMatch: PendingMatch | null;
  /** Links waiting to be posted to the meeting chat after the bot speaks. */
  pendingLinks: string[];
}

/** What the Meeting agent hands to Pipecat (via the Supervisor) to speak. */
export interface SpeakResponse {
  text: string;
  links: string[];
}

/** Post-meeting structured summary (parsed Claude extraction). */
export type MeetingSummaryResult = ExtractDecisionsResult;
