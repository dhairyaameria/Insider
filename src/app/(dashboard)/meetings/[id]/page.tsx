import { ArrowLeft, BotOff } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotStatusBadge, type BotStatus } from "@/components/bot/BotStatusBadge";
import {
  BotInterventionCard,
  type BotIntervention,
} from "@/components/meetings/BotInterventionCard";
import { SummaryPanel } from "@/components/meetings/SummaryPanel";
import { TranscriptView } from "@/components/meetings/TranscriptView";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureOrgUser } from "@/lib/provision";
import {
  getBotSession,
  getMeeting,
  getMeetingChunks,
  getMeetingSummary,
} from "@/lib/supabase/queries";
import type { Json, Meeting } from "@/lib/supabase/types";
import { formatDuration, formatMeetingDate } from "@/lib/utils";
import type { TranscriptChunk } from "@/types/meeting";

export const dynamic = "force-dynamic";

function botStatusForMeeting(meeting: Meeting): BotStatus {
  if (meeting.status === "completed") return "ended";
  if (meeting.status === "active") return meeting.bot_joined ? "listening" : "joining";
  return "scheduled";
}

/**
 * bot_sessions.issues_surfaced is a JSONB audit mirror — parse defensively
 * and skip entries that are missing the essentials.
 */
function parseInterventions(json: Json | undefined): BotIntervention[] {
  if (!Array.isArray(json)) return [];

  return json.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const o = raw as Record<string, Json | undefined>;

    const surfacedAt = typeof o.surfaced_at === "string" ? o.surfaced_at : null;
    if (!surfacedAt) return [];

    const resolvedAtIso =
      typeof o.resolved_at === "string" ? o.resolved_at : surfacedAt;

    return [
      {
        problemSummary:
          typeof o.problem_summary === "string"
            ? o.problem_summary
            : "Problem details not recorded",
        match: {
          id: typeof o.issue_id === "string" ? o.issue_id : "",
          title: typeof o.title === "string" ? o.title : "Past resolved issue",
          resolution: "",
          resolvedAt: new Date(resolvedAtIso),
          similarity: typeof o.similarity === "number" ? o.similarity : 0,
          links: Array.isArray(o.links)
            ? o.links.filter((l): l is string => typeof l === "string")
            : [],
          sourceType: "meeting",
        },
        spokenText: typeof o.spoken_text === "string" ? o.spoken_text : null,
        timestamp: surfacedAt,
      },
    ];
  });
}

export default async function MeetingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await ensureOrgUser();
  if (!user?.org_id) notFound();

  const meeting = await getMeeting(params.id);
  if (!meeting || meeting.org_id !== user.org_id) notFound();

  const [chunks, summary, botSession] = await Promise.all([
    getMeetingChunks(meeting.id),
    getMeetingSummary(meeting.id),
    getBotSession(meeting.id),
  ]);

  // Raw live chunks only — embedded rows are ingestion summaries.
  const transcriptChunks: TranscriptChunk[] = chunks
    .filter((c) => c.embedding === null)
    .map((c) => ({
      meetingId: meeting.id,
      text: c.text,
      speakerLabel: c.speaker_label ?? "Speaker",
      timestamp: c.started_at ?? c.created_at,
    }));

  const interventions = parseInterventions(botSession?.issues_surfaced);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {meeting.title ?? "Untitled meeting"}
          </h1>
          <BotStatusBadge status={botStatusForMeeting(meeting)} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span>
            {formatMeetingDate(meeting.started_at ?? meeting.created_at)}
          </span>
          {meeting.started_at && meeting.ended_at && (
            <span>· {formatDuration(meeting.started_at, meeting.ended_at)}</span>
          )}
          <Badge variant="outline" className="font-normal capitalize">
            {meeting.platform}
          </Badge>
          <Badge variant="outline" className="font-normal capitalize">
            {meeting.ritual_type.replace("_", " ")}
          </Badge>
        </div>
      </div>

      {!meeting.bot_joined ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <BotOff className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium">
              Bot did not join this meeting
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {meeting.status === "scheduled"
                ? "The bot is scheduled and will join when the meeting starts."
                : "No transcript, summary, or interventions are available because the bot never joined."}
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Two-column layout: transcript (60%) | summary + interventions (40%) */
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Left: transcript */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Transcript</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TranscriptView
                chunks={transcriptChunks}
                interventionTimestamps={interventions.map((i) => i.timestamp)}
                startedAt={meeting.started_at}
              />
            </CardContent>
          </Card>

          {/* Right: interventions + summary */}
          <div className="space-y-6">
            {interventions.map((intervention, i) => (
              <BotInterventionCard key={i} intervention={intervention} />
            ))}

            {summary ? (
              <SummaryPanel summary={summary} />
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Meeting summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {meeting.status === "completed"
                      ? "No summary was generated for this meeting."
                      : "The summary will appear here after the meeting ends."}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
