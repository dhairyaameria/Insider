/**
 * Memory agent — stateless read/write layer over pgvector.
 *
 * Receives a request, queries pgvector, returns results; also handles
 * ingestion. No session state lives here.
 *
 * Error policy: every exported function catches internally and logs.
 * Retrieval returns empty results on failure; ingestion logs and continues —
 * an ingestion error never propagates to the caller.
 */

import "server-only";

import { getEmbedAdapter } from "@/lib/adapters/llm";
import { buildEmbeddingText } from "@/lib/prompts/generate-embedding-text";
import {
  getMeetingsByIds,
  saveMeetingChunk,
  saveMemoryItem,
  searchMeetingChunksByEmbedding,
  searchMemoryItems,
  upsertMemoryItemBySource,
} from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";
import type { MeetingSummaryResult as MeetingSummary } from "@/types/meeting";
import type { DecisionResult, MemoryMatch, SearchResult } from "@/types/memory";

const DEFAULT_MATCH_LIMIT = 3;
const DEFAULT_MIN_SIMILARITY = 0.78;
const CHUNK_WORDS = 200;
const CHUNK_OVERLAP_WORDS = 50;

function extractLinks(metadata: unknown): string[] {
  if (metadata && typeof metadata === "object" && "links" in metadata) {
    const links = (metadata as { links?: unknown }).links;
    if (Array.isArray(links)) {
      return links.filter((l): l is string => typeof l === "string");
    }
  }
  return [];
}

// ── 1. findSimilarResolvedIssues ─────────────────────────────────────────

export async function findSimilarResolvedIssues(params: {
  problemSummary: string;
  orgId: string;
  teamId?: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<MemoryMatch[]> {
  const limit = params.limit ?? DEFAULT_MATCH_LIMIT;
  const minSimilarity = params.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  try {
    const embedding = await getEmbedAdapter().embed(params.problemSummary);
    const rows = await searchMemoryItems(
      embedding,
      params.orgId,
      params.teamId,
      limit * 3,
      "resolved",
    );

    return rows
      .filter((row) => row.similarity > minSimilarity && row.resolved_at !== null)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        title: row.title,
        resolution: row.body,
        resolvedAt: new Date(row.resolved_at as string),
        similarity: row.similarity,
        links: extractLinks(row.metadata),
        sourceType: row.source_type,
      }));
  } catch (error) {
    logVendorError("memory-agent", error, {
      orgId: params.orgId,
      stage: "find-similar-resolved-issues",
    });
    return [];
  }
}

// ── 2. ingestMeeting ─────────────────────────────────────────────────────

/** Splits a transcript into ~200-word segments with 50-word overlap. */
function chunkTranscript(
  transcript: string,
  chunkWords = CHUNK_WORDS,
  overlapWords = CHUNK_OVERLAP_WORDS,
): string[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const step = chunkWords - overlapWords;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    chunks.push(words.slice(i, i + chunkWords).join(" "));
    if (i + chunkWords >= words.length) break;
  }
  return chunks;
}

export async function ingestMeeting(params: {
  meetingId: string;
  orgId: string;
  teamId: string | null;
  transcript: string;
  summary: MeetingSummary;
}): Promise<void> {
  const embedder = getEmbedAdapter();

  // a/b. Chunk + embed + store transcript segments (independent → parallel).
  const segments = chunkTranscript(params.transcript);
  await Promise.all(
    segments.map(async (segment) => {
      try {
        const embedding = await embedder.embed(segment);
        await saveMeetingChunk({
          meeting_id: params.meetingId,
          org_id: params.orgId,
          team_id: params.teamId,
          speaker_label: null,
          text: segment,
          embedding,
        });
      } catch (error) {
        logVendorError("memory-agent", error, {
          meetingId: params.meetingId,
          stage: "ingest-chunk",
        });
      }
    }),
  );

  const now = new Date().toISOString();

  // c. Decisions are resolved by definition (independent → parallel).
  await Promise.all(
    params.summary.decisions.map(async (decision) => {
      try {
        const title = decision.decision.slice(0, 120);
        const body = decision.owner
          ? `${decision.decision} (owner: ${decision.owner})`
          : decision.decision;
        const embedding = await embedder.embed(
          buildEmbeddingText({
            title,
            body,
            tags: ["decision"],
            sourceType: "meeting",
          }),
        );

        await saveMemoryItem({
          org_id: params.orgId,
          team_id: params.teamId,
          source_type: "meeting",
          source_id: params.meetingId,
          title,
          body,
          status: "resolved",
          resolved_at: now,
          tags: ["decision"],
          embedding,
        });
      } catch (error) {
        logVendorError("memory-agent", error, {
          meetingId: params.meetingId,
          stage: "ingest-decision",
        });
      }
    }),
  );

  // d. Action items: stored as open knowledge (they are assigned future
  // work, not resolutions — only resolved items surface as suggestions).
  await Promise.all(
    params.summary.action_items.map(async (item) => {
      try {
        const title = item.task.slice(0, 120);
        const body = item.assignee
          ? `${item.task} (assignee: ${item.assignee})`
          : item.task;
        const embedding = await embedder.embed(
          buildEmbeddingText({
            title,
            body,
            tags: ["action_item"],
            sourceType: "meeting",
          }),
        );

        await saveMemoryItem({
          org_id: params.orgId,
          team_id: params.teamId,
          source_type: "meeting",
          source_id: params.meetingId,
          title,
          body,
          status: "open",
          tags: ["action_item"],
          embedding,
        });
      } catch (error) {
        logVendorError("memory-agent", error, {
          meetingId: params.meetingId,
          stage: "ingest-action-item",
        });
      }
    }),
  );
}

// ── 3. ingestTicket ──────────────────────────────────────────────────────

export async function ingestTicket(params: {
  orgId: string;
  teamId: string | null;
  ticket: {
    id: string;
    title: string;
    description: string;
    status: string;
    resolvedAt?: Date;
    url: string;
  };
}): Promise<void> {
  try {
    const { ticket } = params;
    const embedding = await getEmbedAdapter().embed(
      buildEmbeddingText({
        title: ticket.title,
        body: ticket.description,
        tags: [ticket.status],
        sourceType: "ticket",
      }),
    );

    await upsertMemoryItemBySource({
      org_id: params.orgId,
      team_id: params.teamId,
      source_type: "ticket",
      source_id: ticket.id,
      title: ticket.title,
      body: ticket.description,
      status: ticket.resolvedAt ? "resolved" : "open",
      resolved_at: ticket.resolvedAt?.toISOString() ?? null,
      tags: [ticket.status],
      embedding,
      metadata: { links: [ticket.url] },
    });
  } catch (error) {
    logVendorError("memory-agent", error, {
      orgId: params.orgId,
      ticketId: params.ticket.id,
      stage: "ingest-ticket",
    });
  }
}

// ── 4. searchMeetings ────────────────────────────────────────────────────

export async function searchMeetings(params: {
  query: string;
  orgId: string;
  teamId?: string;
  /** Scope the search to a single meeting. */
  meetingId?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  try {
    const embedding = await getEmbedAdapter().embed(params.query);
    const chunks = await searchMeetingChunksByEmbedding(embedding, params.orgId, {
      teamId: params.teamId,
      meetingId: params.meetingId,
      limit: params.limit ?? 10,
    });

    const meetingIds = Array.from(
      new Set(
        chunks
          .map((c) => c.meeting_id)
          .filter((id): id is string => id !== null),
      ),
    );
    const meetings = await getMeetingsByIds(meetingIds);
    const titleById = new Map(meetings.map((m) => [m.id, m.title]));

    return chunks.map((chunk) => ({
      chunkId: chunk.id,
      meetingId: chunk.meeting_id,
      meetingTitle: chunk.meeting_id
        ? (titleById.get(chunk.meeting_id) ?? null)
        : null,
      text: chunk.text,
      speakerLabel: chunk.speaker_label,
      startedAt: chunk.started_at,
      similarity: chunk.similarity,
    }));
  } catch (error) {
    logVendorError("memory-agent", error, {
      orgId: params.orgId,
      stage: "search-meetings",
    });
    return [];
  }
}

// ── 5. getDecisionHistory ────────────────────────────────────────────────

const DECISION_KEYWORDS =
  /\b(decid\w*|decision|chose|chosen|agree\w*|adopt\w*|approved?|go(?:ing)? with|switch\w*)\b/i;

export async function getDecisionHistory(params: {
  query: string;
  orgId: string;
  teamId?: string;
}): Promise<DecisionResult[]> {
  try {
    const embedding = await getEmbedAdapter().embed(params.query);
    const rows = await searchMemoryItems(
      embedding,
      params.orgId,
      params.teamId,
      50,
    );

    return rows
      .filter(
        (row) =>
          row.source_type === "meeting" &&
          (row.tags.includes("decision") ||
            DECISION_KEYWORDS.test(row.title)),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        decidedAt: row.resolved_at ?? row.created_at,
        similarity: row.similarity,
        links: extractLinks(row.metadata),
      }));
  } catch (error) {
    logVendorError("memory-agent", error, {
      orgId: params.orgId,
      stage: "get-decision-history",
    });
    return [];
  }
}
