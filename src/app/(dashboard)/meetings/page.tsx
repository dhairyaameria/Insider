import { format } from "date-fns";
import Link from "next/link";
import { BotStatusBadge, type BotStatus } from "@/components/bot/BotStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ensureOrgUser } from "@/lib/provision";
import {
  getBotSessionsForMeetings,
  getMeetingsByOrg,
  getTeamsByOrg,
} from "@/lib/supabase/queries";
import type { Meeting } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function botStatusForMeeting(meeting: Meeting): BotStatus {
  if (meeting.status === "completed") return "ended";
  if (meeting.status === "active") return meeting.bot_joined ? "listening" : "joining";
  return "scheduled";
}

const TABLE_COLS =
  "grid grid-cols-[minmax(0,1fr)_110px_150px_110px_130px_60px] items-center gap-4";

export default async function MeetingsPage() {
  const user = await ensureOrgUser();

  if (!user?.org_id) {
    return (
      <div className="flex flex-col items-start gap-2 py-20">
        <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
        <p className="text-sm text-muted-foreground">
          Your account isn&apos;t linked to an organization yet. Create or join
          one to start sending the bot to meetings.
        </p>
      </div>
    );
  }

  const [meetings, teams] = await Promise.all([
    getMeetingsByOrg(user.org_id, 50),
    getTeamsByOrg(user.org_id),
  ]);
  const botSessions = await getBotSessionsForMeetings(meetings.map((m) => m.id));
  const issuesByMeeting = new Map(
    botSessions.map((s) => [
      s.meeting_id,
      Array.isArray(s.issues_surfaced) ? s.issues_surfaced.length : 0,
    ]),
  );
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every meeting the bot has been scheduled for, with live status.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {meetings.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium">No meetings yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Schedule the bot for your next standup to get started — it will
                appear here with its live status.
              </p>
            </div>
          ) : (
            <div>
              <div
                className={`${TABLE_COLS} border-b px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground`}
              >
                <span>Title</span>
                <span>Team</span>
                <span>Date</span>
                <span>Ritual</span>
                <span>Bot</span>
                <span className="text-right">Issues</span>
              </div>
              {meetings.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className={`${TABLE_COLS} border-b px-6 py-3 text-sm transition-colors last:border-0 hover:bg-accent/50`}
                >
                  <span className="truncate font-medium">
                    {meeting.title ?? "Untitled meeting"}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {(meeting.team_id && teamNameById.get(meeting.team_id)) ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {format(
                      new Date(meeting.started_at ?? meeting.created_at),
                      "MMM d, h:mm a",
                    )}
                  </span>
                  <span>
                    <Badge variant="outline" className="font-normal capitalize">
                      {meeting.ritual_type.replace("_", " ")}
                    </Badge>
                  </span>
                  <span>
                    <BotStatusBadge status={botStatusForMeeting(meeting)} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {issuesByMeeting.get(meeting.id) ?? 0}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
