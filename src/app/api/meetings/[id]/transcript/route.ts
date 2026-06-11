import { NextRequest, NextResponse } from "next/server";
import { errorJson, logRequest, requireOrgUser } from "@/lib/api";
import { getMeeting, getMeetingChunks } from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";

/** GET /api/meetings/:id/transcript — full transcript grouped by speaker turns. */

export const runtime = "nodejs";

const ROUTE = "GET /api/meetings/:id/transcript";

interface TranscriptSegment {
  speaker: string;
  text: string;
  startedAt: string | null;
  endedAt: string | null;
}

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
    if (!meeting || meeting.org_id !== orgId) {
      logRequest(ROUTE, startedAt, 404, { orgId, meetingId: params.id });
      return errorJson("NOT_FOUND", "meeting not found", 404);
    }

    // Raw live chunks only (embedded re-ingested segments carry no speaker).
    const chunks = (await getMeetingChunks(meeting.id)).filter(
      (chunk) => chunk.embedding === null,
    );

    // Group consecutive chunks from the same speaker into turns.
    const segments: TranscriptSegment[] = [];
    for (const chunk of chunks) {
      const speaker = chunk.speaker_label ?? "unknown";
      const last = segments[segments.length - 1];
      if (last && last.speaker === speaker) {
        last.text += ` ${chunk.text}`;
        last.endedAt = chunk.ended_at ?? chunk.started_at ?? last.endedAt;
      } else {
        segments.push({
          speaker,
          text: chunk.text,
          startedAt: chunk.started_at,
          endedAt: chunk.ended_at ?? chunk.started_at,
        });
      }
    }

    logRequest(ROUTE, startedAt, 200, {
      orgId,
      meetingId: meeting.id,
      chunkCount: chunks.length,
    });
    return NextResponse.json({
      meetingId: meeting.id,
      segments,
      chunkCount: chunks.length,
    });
  } catch (error) {
    logVendorError("meeting-transcript-api", error, { meetingId: params.id });
    logRequest(ROUTE, startedAt, 500);
    return errorJson("INTERNAL_ERROR", "failed to load transcript", 500);
  }
}
