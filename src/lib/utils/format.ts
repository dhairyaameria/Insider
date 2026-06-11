import { format, formatDistanceToNow, intervalToDuration } from "date-fns";

export function formatMeetingDate(date: Date | string): string {
  return format(new Date(date), "MMM d, yyyy · h:mm a");
}

export function formatRelative(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDuration(start: Date | string, end: Date | string): string {
  const duration = intervalToDuration({
    start: new Date(start),
    end: new Date(end),
  });
  const parts: string[] = [];
  if (duration.hours) parts.push(`${duration.hours}h`);
  if (duration.minutes) parts.push(`${duration.minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "<1m";
}

/** Timestamp for transcript lines, e.g. "00:14:32". */
export function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
