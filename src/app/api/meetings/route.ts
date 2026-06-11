import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMeetingBotAdapter } from "@/lib/adapters/meetingbot";
import {
  createMeeting,
  getUserByClerkId,
  updateMeeting,
} from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";

/** POST /api/meetings — schedule the bot for a meeting. */

export const runtime = "nodejs";

const bodySchema = z.object({
  meetingUrl: z.url(),
  title: z.string().min(1).max(300),
  teamId: z.uuid().optional(),
  scheduledAt: z.iso.datetime().optional(),
});

function detectPlatform(meetingUrl: string): "zoom" | "meet" | "teams" | null {
  try {
    const host = new URL(meetingUrl).hostname;
    if (host.includes("zoom.us")) return "zoom";
    if (host.includes("meet.google.com")) return "meet";
    if (host.includes("teams.microsoft.com") || host.includes("teams.live.com")) {
      return "teams";
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Auth with Clerk.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(userId);
  if (!user?.org_id) {
    return NextResponse.json(
      { error: "user has no organization" },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { meetingUrl, title, teamId, scheduledAt } = parsed.data;

  const platform = detectPlatform(meetingUrl);
  if (!platform) {
    return NextResponse.json(
      { error: "unsupported meeting platform — expected Zoom, Google Meet, or Teams" },
      { status: 400 },
    );
  }

  try {
    const meeting = await createMeeting({
      org_id: user.org_id,
      team_id: teamId ?? null,
      platform,
      meeting_url: meetingUrl,
      title,
      status: "scheduled",
      started_at: scheduledAt ?? null,
    });

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    try {
      const { botId } = await getMeetingBotAdapter().joinMeeting(
        meetingUrl,
        "Insider",
        `${appUrl}/api/bot/webhook`,
      );

      const updated = await updateMeeting(meeting.id, {
        external_meeting_id: botId,
      });

      return NextResponse.json({ meeting: updated }, { status: 201 });
    } catch (error) {
      // Bot scheduling failed — keep the meeting record for retry.
      logVendorError("meetings-api", error, {
        meetingId: meeting.id,
        stage: "join-meeting",
      });
      return NextResponse.json(
        { error: "failed to schedule meeting bot", meeting },
        { status: 502 },
      );
    }
  } catch (error) {
    logVendorError("meetings-api", error, { stage: "create-meeting" });
    return NextResponse.json(
      { error: "failed to create meeting" },
      { status: 500 },
    );
  }
}
