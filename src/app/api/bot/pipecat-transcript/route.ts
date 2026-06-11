import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateMeetingSession } from "@/lib/agents/meeting";
import { logVendorError } from "@/lib/utils/errors";

/**
 * Receives final transcript chunks from the Pipecat sidecar.
 * Separate from the MeetingBaaS webhook, but identical downstream
 * behaviour to a transcript.final event.
 *
 * Guardrail: aside from auth failures, this handler always returns 200 —
 * errors are caught internally so the sidecar never retries and the
 * meeting never sees duplicate events.
 */

export const runtime = "nodejs";

const chunkSchema = z.object({
  meeting_id: z.string().min(1),
  text: z.string().min(1),
  speaker_label: z.string().nullish(),
  timestamp: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.PIPECAT_SERVICE_SECRET;
  const authorization = req.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = chunkSchema.safeParse(body);
    if (!parsed.success) {
      logVendorError("pipecat-webhook", "invalid transcript chunk payload", {
        issues: parsed.error.issues,
      });
      return NextResponse.json({ ok: true });
    }

    const { meeting_id, text, speaker_label, timestamp } = parsed.data;
    const session = await getOrCreateMeetingSession(meeting_id);
    if (session) {
      await session.addChunk({
        meetingId: meeting_id,
        text,
        speakerLabel: speaker_label ?? "unknown",
        timestamp: timestamp ?? new Date().toISOString(),
      });
    }
  } catch (error) {
    logVendorError("pipecat-webhook", error, {});
  }

  return NextResponse.json({ ok: true });
}
