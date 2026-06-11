import { NextRequest, NextResponse } from "next/server";
import { errorJson, logRequest, requireOrgUser } from "@/lib/api";
import {
  getBotSession,
  getMeeting,
  getMeetingSummary,
} from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";

/** GET /api/meetings/:id — meeting with summary, decisions, action items, and bot session. */

export const runtime = "nodejs";

const ROUTE = "GET /api/meetings/:id";

export async function GET(
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
    // Org scoping: a foreign meeting is indistinguishable from a missing one.
    if (!meeting || meeting.org_id !== orgId) {
      logRequest(ROUTE, startedAt, 404, { orgId, meetingId: params.id });
      return errorJson("NOT_FOUND", "meeting not found", 404);
    }

    const [summary, botSession] = await Promise.all([
      getMeetingSummary(meeting.id),
      getBotSession(meeting.id),
    ]);

    logRequest(ROUTE, startedAt, 200, { orgId, meetingId: meeting.id });
    return NextResponse.json({
      meeting,
      summary: summary
        ? {
            summaryText: summary.summary_text,
            decisions: summary.decisions,
            actionItems: summary.action_items,
            risks: summary.risks,
            createdAt: summary.created_at,
          }
        : null,
      botSession: botSession
        ? {
            issuesSurfaced: botSession.issues_surfaced,
            handRaisedAt: botSession.hand_raised_at,
            lastSpokeAt: botSession.last_spoke_at,
            updatedAt: botSession.updated_at,
          }
        : null,
    });
  } catch (error) {
    logVendorError("meeting-detail-api", error, { meetingId: params.id });
    logRequest(ROUTE, startedAt, 500);
    return errorJson("INTERNAL_ERROR", "failed to load meeting", 500);
  }
}
