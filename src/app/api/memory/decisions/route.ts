import { NextRequest, NextResponse } from "next/server";
import { getDecisionHistory } from "@/lib/agents/memory";
import { errorJson, logRequest, requireOrgUser } from "@/lib/api";
import { logVendorError } from "@/lib/utils/errors";

/** GET /api/memory/decisions?query=...&teamId=...&limit=... — decision history. */

export const runtime = "nodejs";
// Auth + query params make this per-request; never prerender at build.
export const dynamic = "force-dynamic";

const ROUTE = "GET /api/memory/decisions";

export async function GET(req: NextRequest) {
  const startedAt = Date.now();

  try {
    const authResult = await requireOrgUser();
    if (!authResult.ok) {
      logRequest(ROUTE, startedAt, authResult.response.status);
      return authResult.response;
    }
    const { orgId } = authResult;

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query")?.trim();
    if (!query) {
      logRequest(ROUTE, startedAt, 400, { orgId });
      return errorJson("MISSING_QUERY", "query parameter is required", 400);
    }

    const teamId = searchParams.get("teamId") ?? undefined;
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
      50,
    );

    const decisions = (
      await getDecisionHistory({ query, orgId, teamId })
    ).slice(0, limit);

    logRequest(ROUTE, startedAt, 200, { orgId, resultCount: decisions.length });
    return NextResponse.json({
      decisions,
      query,
      totalCount: decisions.length,
    });
  } catch (error) {
    logVendorError("memory-decisions-api", error, {});
    logRequest(ROUTE, startedAt, 500);
    return errorJson("INTERNAL_ERROR", "decision lookup failed", 500);
  }
}
