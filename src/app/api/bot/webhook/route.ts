import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateMeetingSession, getSession } from "@/lib/agents/meeting";
import { supervisor } from "@/lib/agents/supervisor";
import { getPipecatAdapter } from "@/lib/adapters/pipecat";
import {
  getMeetingByExternalId,
  updateMeeting,
} from "@/lib/supabase/queries";
import type { Meeting } from "@/lib/supabase/types";
import { logVendorError } from "@/lib/utils/errors";

/**
 * MeetingBaaS webhook — receives real-time bot events and drives the agent
 * system.
 *
 * Transcript chunks arrive from TWO sources: the Pipecat sidecar webhook
 * (/api/bot/pipecat-transcript) is the primary real-time path; the
 * transcript.final events here are the backup/recording path, deduplicated
 * by chunk timestamp.
 *
 * Guardrail #7: aside from signature failures (401), this handler ALWAYS
 * returns 200 — a 5xx makes MeetingBaaS retry, causing duplicate events
 * and duplicate speech. Every error is caught internally.
 */

export const runtime = "nodejs";

const eventSchema = z.object({
  event: z.string(),
  botId: z.string().optional(),
  bot_id: z.string().optional(),
  meetingId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const transcriptDataSchema = z.object({
  text: z.string().min(1),
  speaker: z.string().nullish(),
  speaker_label: z.string().nullish(),
  timestamp: z.string().nullish(),
});

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.MEETINGBAAS_WEBHOOK_SECRET;
  if (!secret) {
    // Unconfigured secret: accept but warn (local dev). Set the secret in
    // production — verification is strict once present.
    console.warn(
      "MEETINGBAAS_WEBHOOK_SECRET not set — skipping webhook signature verification",
    );
    return true;
  }
  if (!signature) return false;

  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody).digest("hex"),
  );
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // 1. Authenticate the webhook.
  if (!verifySignature(rawBody, req.headers.get("x-meetingbaas-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  try {
    // 2. Parse the event.
    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      logVendorError("meetingbaas-webhook", "invalid event payload", {
        issues: parsed.error.issues,
      });
      return NextResponse.json({ ok: true });
    }

    const { event, data } = parsed.data;
    const botId = parsed.data.botId ?? parsed.data.bot_id;
    if (!botId) {
      logVendorError("meetingbaas-webhook", "event missing bot id", { event });
      return NextResponse.json({ ok: true });
    }

    // 3. Look up the internal meeting by external bot id.
    const meeting = await getMeetingByExternalId(botId);
    if (!meeting) {
      logVendorError("meetingbaas-webhook", "no meeting for bot id", {
        event,
        botId,
      });
      return NextResponse.json({ ok: true });
    }

    // 4. Route by event type.
    switch (event) {
      case "bot.joined":
        await handleBotJoined(meeting, botId, data);
        break;
      case "bot.left":
        console.info(
          JSON.stringify({
            level: "info",
            event: "bot_left",
            meetingId: meeting.id,
            botId,
            timestamp: new Date().toISOString(),
          }),
        );
        break;
      case "transcript.partial":
        // Ignored: the rolling window consumes final chunks only.
        break;
      case "transcript.final":
        await handleTranscriptFinal(meeting, data);
        break;
      case "meeting.ended":
        await handleMeetingEnded(meeting);
        break;
      default:
        logVendorError("meetingbaas-webhook", "unknown event type", {
          event,
          meetingId: meeting.id,
        });
    }
  } catch (error) {
    logVendorError("meetingbaas-webhook", error, {});
  }

  // 5. Always 200.
  return NextResponse.json({ ok: true }, { status: 200 });
}

async function handleBotJoined(
  meeting: Meeting,
  botId: string,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  await updateMeeting(meeting.id, {
    bot_joined: true,
    status: "active",
    started_at: new Date().toISOString(),
  });

  // Creates the session and detects the ritual type from the meeting title.
  const session = await getOrCreateMeetingSession(meeting.id);
  if (!session) return;

  const meetingUrl =
    meeting.meeting_url ??
    (typeof data?.meeting_url === "string" ? data.meeting_url : null);
  if (!meetingUrl) {
    logVendorError("meetingbaas-webhook", "no meeting url — cannot spawn Pipecat", {
      meetingId: meeting.id,
      botId,
    });
    return;
  }

  try {
    const { pipecatBotId } = await getPipecatAdapter().spawnBot({
      meetingUrl,
      botName: "Insider",
      meetingId: meeting.id,
    });
    session.registerBotIds(botId, pipecatBotId);

    console.info(
      JSON.stringify({
        level: "info",
        event: "bot_joined",
        meetingId: meeting.id,
        botId,
        pipecatBotId,
        ritualType: session.ritualType,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    // Pipecat down → the bot still records via MeetingBaaS transcripts; it
    // just cannot speak this meeting.
    logVendorError("meetingbaas-webhook", error, {
      meetingId: meeting.id,
      stage: "spawn-pipecat",
    });
  }
}

async function handleTranscriptFinal(
  meeting: Meeting,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const session = getSession(meeting.id);
  if (!session) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "transcript_without_session",
        meetingId: meeting.id,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  const parsed = transcriptDataSchema.safeParse(data);
  if (!parsed.success) return;

  const timestamp = parsed.data.timestamp ?? new Date().toISOString();

  // Backup path: skip if the Pipecat webhook already delivered this chunk.
  if (session.hasChunkAt(timestamp)) return;

  await session.addChunk({
    meetingId: meeting.id,
    text: parsed.data.text,
    speakerLabel:
      parsed.data.speaker_label ?? parsed.data.speaker ?? "unknown",
    timestamp,
  });
}

async function handleMeetingEnded(meeting: Meeting): Promise<void> {
  const session = getSession(meeting.id);

  if (session) {
    if (meeting.org_id) {
      await supervisor.handleMeetingEnd({
        meetingId: meeting.id,
        session,
        orgId: meeting.org_id,
        teamId: meeting.team_id,
      });
    }

    if (session.pipecatBotId) {
      try {
        await getPipecatAdapter().terminateBot(session.pipecatBotId);
      } catch (error) {
        logVendorError("meetingbaas-webhook", error, {
          meetingId: meeting.id,
          stage: "terminate-pipecat",
        });
      }
    }
  }

  await updateMeeting(meeting.id, {
    status: "completed",
    ended_at: new Date().toISOString(),
  });
}
