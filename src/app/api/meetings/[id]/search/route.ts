import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchMeetings } from "@/lib/agents/memory";
import { errorJson, logRequest, requireOrgUser } from "@/lib/api";
import { getMeeting } from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";

/** POST /api/meetings/:id/search — semantic search within one meeting. */

export const runtime = "nodejs";

const ROUTE = "POST /api/meetings/:id/search";

const bodySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const startedAt = Date.now();

  try {
    const authResult = await requireOrgUser();
    if (!authResult.ok) {
      logRequest(ROUTE, startedAt, authResult.response.status);
      return authResult.response;
    }
    const { orgId } = authResult;

    const meeting = await getMeeting(params.id);
    if (!meeting || meeting.org_id !== orgId) {
      logRequest(ROUTE, startedAt, 404, { orgId, meetingId: params.id });
      return errorJson("NOT_FOUND", "meeting not found", 404);
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      logRequest(ROUTE, startedAt, 400, { orgId, meetingId: meeting.id });
      return errorJson("INVALID_BODY", "invalid request body", 400);
    }
    const { query, limit = 10 } = parsed.data;

    const results = await searchMeetings({
      query,
      orgId,
      meetingId: meeting.id,
      limit,
    });

    logRequest(ROUTE, startedAt, 200, {
      orgId,
      meetingId: meeting.id,
      resultCount: results.length,
    });
    return NextResponse.json({
      results,
      query,
      totalCount: results.length,
    });
  } catch (error) {
    logVendorError("meeting-search-api", error, { meetingId: params.id });
    logRequest(ROUTE, startedAt, 500);
    return errorJson("INTERNAL_ERROR", "search failed", 500);
  }
}
