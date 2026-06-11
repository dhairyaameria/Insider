/**
 * Meeting agent — the in-meeting brain.
 *
 * Stateful: one MeetingSession per active meeting. Holds the rolling 90s
 * transcript window, runs Claude classification every ~15s, checks memory
 * for matching resolved issues, and composes spoken responses when the
 * Supervisor decides to speak.
 *
 * Guardrails honored here:
 * - speaks at most once per unique issue per meeting (issuesSurfaced check)
 * - 60s cooldown between spoken turns (queues instead of raising again)
 * - never calls TTS directly — Pipecat owns audio via triggerSpeak()
 * - classification/memory failures degrade gracefully: transcription continues
 */

import "server-only";

import { getLLMAdapter } from "@/lib/adapters/llm";
import {
  buildClassifyProblemPrompt,
  type ClassifyProblemResult,
  type ProblemType,
} from "@/lib/prompts/classify-problem";
import { buildComposeResponsePrompt } from "@/lib/prompts/compose-response";
import { buildExtractDecisionsPrompt } from "@/lib/prompts/extract-decisions";
import { getRedis } from "@/lib/redis";
import {
  getMeeting,
  getMeetingChunks,
  saveMeetingChunk,
  upsertBotSession,
} from "@/lib/supabase/queries";
import { AppError, logVendorError } from "@/lib/utils/errors";
import { parseLlmJson } from "@/lib/utils/json";
import { summarySimilarity } from "@/lib/utils/text";
import type {
  BotSessionState,
  MeetingSummaryResult,
  PendingMatch,
  RitualType,
  SpeakResponse,
  TranscriptChunk,
} from "@/types/meeting";
import { findSimilarResolvedIssues } from "./memory";
import { supervisor } from "./supervisor";

const TRANSCRIPT_WINDOW_MS = 90_000;
const CLASSIFICATION_INTERVAL_MS = 15_000;
const MIN_CLASSIFICATION_CONFIDENCE = 0.7;
const SPEAK_COOLDOWN_MS = 60_000;
/** Word-overlap ratio above which two problem summaries count as the same issue. */
const SAME_ISSUE_SIMILARITY = 0.6;
const REDIS_SESSION_TTL_S = 6 * 60 * 60;

export class MeetingSession {
  private transcriptWindow: TranscriptChunk[] = [];
  private sessionState: BotSessionState = {
    issuesSurfaced: [],
    handRaisedAt: null,
    lastSpokeAt: null,
    pendingMatch: null,
    pendingLinks: [],
  };
  private lastClassifiedAt: number = Date.now();
  private readonly classificationIntervalMs = CLASSIFICATION_INTERVAL_MS;
  private classifying = false;
  private ended = false;

  /** MeetingBaaS bot id — registered by the join flow. */
  public botId: string | null = null;
  /** Pipecat sidecar bot id — registered by the join flow. */
  public pipecatBotId: string | null = null;

  constructor(
    public readonly meetingId: string,
    public readonly orgId: string,
    public readonly teamId: string | null,
    public readonly ritualType: RitualType,
  ) {}

  registerBotIds(botId: string, pipecatBotId: string): void {
    this.botId = botId;
    this.pipecatBotId = pipecatBotId;
  }

  // ── a. addChunk ────────────────────────────────────────────────────────

  async addChunk(chunk: TranscriptChunk): Promise<void> {
    if (this.ended) return;

    this.transcriptWindow.push(chunk);
    this.trimWindow();

    // Persist fire-and-forget — storage must never block live transcription.
    void saveMeetingChunk({
      meeting_id: this.meetingId,
      org_id: this.orgId,
      team_id: this.teamId,
      speaker_label: chunk.speakerLabel,
      text: chunk.text,
      started_at: chunk.timestamp,
    }).catch((error) =>
      logVendorError("meeting-agent", error, {
        meetingId: this.meetingId,
        stage: "persist-chunk",
      }),
    );

    if (Date.now() - this.lastClassifiedAt > this.classificationIntervalMs) {
      await this._classifyWindow();
    }
  }

  // ── b. _classifyWindow ─────────────────────────────────────────────────

  private async _classifyWindow(): Promise<void> {
    if (this.classifying || this.ended) return;
    const windowText = this.getWindowText();
    if (!windowText) return;

    this.classifying = true;
    this.lastClassifiedAt = Date.now();
    try {
      const { system, user } = buildClassifyProblemPrompt(windowText);
      const raw = await getLLMAdapter().complete(system, user, {
        maxTokens: 300,
        temperature: 0,
      });

      const result = parseLlmJson<ClassifyProblemResult>(raw);
      if (!result) {
        logVendorError("meeting-agent", "unparseable classification response", {
          meetingId: this.meetingId,
          stage: "classify",
        });
        return;
      }

      if (
        result.is_problem &&
        result.confidence > MIN_CLASSIFICATION_CONFIDENCE &&
        result.problem_summary &&
        result.problem_type
      ) {
        await this._handleProblemDetected(
          result.problem_summary,
          result.problem_type,
        );
      }
    } catch (error) {
      // Graceful degradation: classification failure never stops transcription.
      logVendorError("meeting-agent", error, {
        meetingId: this.meetingId,
        stage: "classify",
      });
    } finally {
      this.classifying = false;
    }
  }

  // ── c. _handleProblemDetected ──────────────────────────────────────────

  private async _handleProblemDetected(
    problemSummary: string,
    problemType: ProblemType,
  ): Promise<void> {
    try {
      const matches = await findSimilarResolvedIssues({
        problemSummary,
        orgId: this.orgId,
        teamId: this.teamId ?? undefined,
      });
      if (matches.length === 0) {
        console.info(
          JSON.stringify({
            level: "info",
            agent: "meeting",
            event: "no_memory_match",
            meetingId: this.meetingId,
            problemSummary,
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      const best = matches[0];

      // Cheap early exit; the Supervisor's shouldRaiseHand() is the
      // authoritative once-per-unique-issue guardrail.
      const alreadySurfaced = this.sessionState.issuesSurfaced.some(
        (issue) =>
          issue.issueId === best.id ||
          summarySimilarity(issue.problemSummary, problemSummary) >=
            SAME_ISSUE_SIMILARITY,
      );
      if (alreadySurfaced) return;

      const pendingMatch: PendingMatch = {
        problemSummary,
        problemType,
        issueId: best.id,
        title: best.title,
        resolution: best.resolution,
        resolvedAt: best.resolvedAt.toISOString(),
        links: best.links,
        similarity: best.similarity,
        queuedAt: new Date().toISOString(),
      };

      // Spoke too recently → queue the match instead of raising immediately.
      const lastSpokeAt = this.sessionState.lastSpokeAt
        ? new Date(this.sessionState.lastSpokeAt).getTime()
        : 0;
      if (Date.now() - lastSpokeAt < SPEAK_COOLDOWN_MS) {
        this.sessionState.pendingMatch = pendingMatch;
        this.syncSessionState();
        return;
      }

      this.sessionState.pendingMatch = pendingMatch;
      this.syncSessionState();

      if (!this.botId || !this.pipecatBotId) {
        logVendorError(
          "meeting-agent",
          "bot ids not registered — cannot raise hand",
          { meetingId: this.meetingId },
        );
        return;
      }

      await supervisor.handleProblemMatch({
        meetingId: this.meetingId,
        botId: this.botId,
        pipecatBotId: this.pipecatBotId,
        problemSummary,
        match: best,
        session: this,
      });
    } catch (error) {
      // Memory down → bot keeps transcribing, just doesn't raise its hand.
      logVendorError("meeting-agent", error, {
        meetingId: this.meetingId,
        stage: "handle-problem",
      });
    }
  }

  // ── d. onReadyToSpeak ──────────────────────────────────────────────────

  /**
   * Supervisor approved speaking. Composes the 1-2 sentence response.
   * Does NOT call TTS — the Supervisor sends the text to Pipecat via
   * getPipecatAdapter().triggerSpeak().
   */
  async onReadyToSpeak(): Promise<SpeakResponse> {
    const pending = this.sessionState.pendingMatch;
    if (!pending) {
      throw new AppError(
        `No pending match to speak for meeting ${this.meetingId}`,
        "NO_PENDING_MATCH",
        409,
      );
    }

    const { system, user } = buildComposeResponsePrompt(pending.problemSummary, {
      title: pending.title,
      resolution: pending.resolution,
      resolvedAt: pending.resolvedAt,
      links: pending.links,
    });
    const text = await getLLMAdapter().complete(system, user, {
      maxTokens: 200,
      temperature: 0,
    });

    return { text: text.trim(), links: pending.links };
  }

  /**
   * Called by the Supervisor after triggering Pipecat speech. Stamps
   * lastSpokeAt and the spoken text, clears the pending match, and keeps
   * the links for the chat follow-up.
   */
  markSpoke(links: string[] = [], spokenText?: string): void {
    const pending = this.sessionState.pendingMatch;

    if (spokenText) {
      const record = pending
        ? this.sessionState.issuesSurfaced.find(
            (issue) => issue.issueId === pending.issueId,
          )
        : this.sessionState.issuesSurfaced.at(-1);

      if (record) {
        record.spokenText = spokenText;
      } else if (pending) {
        // Ready-to-speak path for a queued match that never went through
        // recordHandRaised — record it now so the audit trail is complete.
        this.sessionState.issuesSurfaced.push({
          issueId: pending.issueId,
          problemSummary: pending.problemSummary,
          surfacedAt: new Date().toISOString(),
          title: pending.title,
          similarity: pending.similarity,
          resolvedAt: pending.resolvedAt,
          links: pending.links,
          spokenText,
        });
      }
    }

    this.sessionState.lastSpokeAt = new Date().toISOString();
    this.sessionState.pendingMatch = null;
    this.sessionState.pendingLinks = links;
    this.syncSessionState();
  }

  /** Called by the Supervisor when it decides to raise the bot's hand. */
  recordHandRaised(issueId: string, problemSummary: string): void {
    const now = new Date().toISOString();
    const pending = this.sessionState.pendingMatch;
    const detail = pending && pending.issueId === issueId ? pending : null;
    this.sessionState.issuesSurfaced.push({
      issueId,
      problemSummary,
      surfacedAt: now,
      title: detail?.title ?? null,
      similarity: detail?.similarity ?? null,
      resolvedAt: detail?.resolvedAt ?? null,
      links: detail?.links ?? [],
      spokenText: null,
    });
    this.sessionState.handRaisedAt = now;
    this.syncSessionState();
  }

  // ── e. endSession ──────────────────────────────────────────────────────

  async endSession(): Promise<MeetingSummaryResult> {
    this.ended = true;
    removeSession(this.meetingId);

    const chunks = await getMeetingChunks(this.meetingId);
    const fullTranscript =
      chunks.length > 0
        ? chunks
            .map((c) => `${c.speaker_label ?? "unknown"}: ${c.text}`)
            .join("\n")
        : this.getWindowText();

    const meeting = await getMeeting(this.meetingId);
    const { system, user } = buildExtractDecisionsPrompt(
      fullTranscript,
      meeting?.title ?? "Untitled meeting",
    );
    const raw = await getLLMAdapter().complete(system, user, {
      maxTokens: 2048,
      temperature: 0,
    });

    const summary = parseLlmJson<MeetingSummaryResult>(raw) ?? {
      summary: "",
      decisions: [],
      action_items: [],
      risks: [],
    };

    // Persistence + Slack + memory ingestion are orchestrated by
    // supervisor.handleMeetingEnd() — this method only extracts.
    return summary;
  }

  // ── internals ──────────────────────────────────────────────────────────

  getWindowText(): string {
    this.trimWindow();
    return this.transcriptWindow
      .map((c) => `${c.speakerLabel}: ${c.text}`)
      .join("\n");
  }

  /**
   * Dedup check for the MeetingBaaS backup transcript path: true if a chunk
   * with this timestamp already arrived (normally via the Pipecat webhook).
   */
  hasChunkAt(timestamp: string): boolean {
    const target = new Date(timestamp).getTime();
    return this.transcriptWindow.some(
      (c) => new Date(c.timestamp).getTime() === target,
    );
  }

  getSessionState(): Readonly<BotSessionState> {
    return this.sessionState;
  }

  private trimWindow(): void {
    const cutoff = Date.now() - TRANSCRIPT_WINDOW_MS;
    this.transcriptWindow = this.transcriptWindow.filter(
      (c) => new Date(c.timestamp).getTime() >= cutoff,
    );
  }

  /** Fire-and-forget durability: Redis is the live store, Postgres the audit mirror. */
  private syncSessionState(): void {
    const redis = getRedis();
    if (redis) {
      void redis
        .set(`bot_session:${this.meetingId}`, JSON.stringify(this.sessionState), {
          ex: REDIS_SESSION_TTL_S,
        })
        .catch((error) =>
          logVendorError("redis", error, {
            meetingId: this.meetingId,
            stage: "sync-session",
          }),
        );
    }

    void upsertBotSession(this.meetingId, {
      issues_surfaced: this.sessionState.issuesSurfaced.map((issue) => ({
        issue_id: issue.issueId,
        surfaced_at: issue.surfacedAt,
        problem_summary: issue.problemSummary,
        title: issue.title ?? null,
        similarity: issue.similarity ?? null,
        resolved_at: issue.resolvedAt ?? null,
        links: issue.links ?? [],
        spoken_text: issue.spokenText ?? null,
      })),
      hand_raised_at: this.sessionState.handRaisedAt,
      last_spoke_at: this.sessionState.lastSpokeAt,
    }).catch((error) =>
      logVendorError("meeting-agent", error, {
        meetingId: this.meetingId,
        stage: "mirror-session",
      }),
    );
  }
}

// ── 3. Ritual detection ──────────────────────────────────────────────────

export function detectRitualType(meetingTitle: string): RitualType {
  const title = meetingTitle.toLowerCase();
  if (
    title.includes("standup") ||
    title.includes("stand-up") ||
    title.includes("daily")
  ) {
    return "standup";
  }
  if (title.includes("planning") || title.includes("sprint")) {
    return "planning";
  }
  if (
    title.includes("incident") ||
    title.includes("postmortem") ||
    title.includes("post-mortem") ||
    /\brca\b/.test(title)
  ) {
    return "incident_review";
  }
  return "general";
}

// ── 4. Session registry ──────────────────────────────────────────────────

/**
 * In-memory singleton registry, cached on globalThis so it survives dev hot
 * reloads. NOTE: per-instance on serverless — Redis/bot_sessions provide
 * cross-instance durability.
 */
const globalForSessions = globalThis as unknown as {
  __insiderMeetingSessions?: Map<string, MeetingSession>;
};

const sessionRegistry =
  globalForSessions.__insiderMeetingSessions ??
  new Map<string, MeetingSession>();
globalForSessions.__insiderMeetingSessions = sessionRegistry;

export function getSession(meetingId: string): MeetingSession | undefined {
  return sessionRegistry.get(meetingId);
}

export function removeSession(meetingId: string): void {
  sessionRegistry.delete(meetingId);
}

/**
 * Webhook entry point: returns the live session for a meeting, creating it
 * from the meetings row (org scope + ritual detection) on first chunk.
 * Returns null for unknown meetings — callers log and drop the event.
 */
export async function getOrCreateMeetingSession(
  meetingId: string,
): Promise<MeetingSession | null> {
  const existing = sessionRegistry.get(meetingId);
  if (existing) return existing;

  const meeting = await getMeeting(meetingId);
  if (!meeting || !meeting.org_id) {
    logVendorError("meeting-agent", "meeting not found for session", {
      meetingId,
    });
    return null;
  }

  const session = new MeetingSession(
    meetingId,
    meeting.org_id,
    meeting.team_id,
    detectRitualType(meeting.title ?? ""),
  );
  sessionRegistry.set(meetingId, session);
  return session;
}
