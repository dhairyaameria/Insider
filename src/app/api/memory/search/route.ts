import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  findSimilarResolvedIssues,
  searchMeetings,
} from "@/lib/agents/memory";
import { errorJson, logRequest, requireOrgUser } from "@/lib/api";
import { logVendorError } from "@/lib/utils/errors";
import type { CombinedSearchResult } from "@/types/memory";

/** POST /api/memory/search — cross-meeting semantic search. */

export const runtime = "nodejs";

const ROUTE = "POST /api/memory/search";

const bodySchema = z.object({
  query: z.string().min(1).max(1000),
  teamId: z.uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  try {
    const authResult = await requireOrgUser();
    if (!authResult.ok) {
      logRequest(ROUTE, startedAt, authResult.response.status);
      return authResult.response;
    }
    const { orgId } = authResult;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      logRequest(ROUTE, startedAt, 400, { orgId });
      return errorJson("INVALID_BODY", "invalid request body", 400);
    }
    const { query, teamId, limit = 20 } = parsed.data;

    // Transcript chunks + resolved memory items (broader 0.7 threshold).
    const [chunkResults, memoryMatches] = await Promise.all([
      searchMeetings({ query, orgId, teamId, limit }),
      findSimilarResolvedIssues({
        problemSummary: query,
        orgId,
        teamId,
        limit,
        minSimilarity: 0.7,
      }),
    ]);

    const combined: CombinedSearchResult[] = [
      ...chunkResults.map(
        (chunk): CombinedSearchResult => ({
          id: chunk.chunkId,
          kind: "transcript",
          title: chunk.meetingTitle,
          text: chunk.text,
          meetingId: chunk.meetingId,
          similarity: chunk.similarity,
          links: [],
          resolvedAt: null,
        }),
      ),
      ...memoryMatches.map(
        (match): CombinedSearchResult => ({
          id: match.id,
          kind: "memory",
          title: match.title,
          text: match.resolution,
          meetingId: null,
          similarity: match.similarity,
          links: match.links,
          resolvedAt: match.resolvedAt.toISOString(),
        }),
      ),
    ];

    // Deduplicate (kind+id) and rank by similarity.
    const seen = new Set<string>();
    const results = combined
      .filter((result) => {
        const key = `${result.kind}:${result.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logRequest(ROUTE, startedAt, 200, { orgId, resultCount: results.length });
    return NextResponse.json({
      results,
      query,
      totalCount: results.length,
    });
  } catch (error) {
    logVendorError("memory-search-api", error, {});
    logRequest(ROUTE, startedAt, 500);
    return errorJson("INTERNAL_ERROR", "search failed", 500);
  }
}
