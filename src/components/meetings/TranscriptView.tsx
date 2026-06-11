"use client";

import { Hand } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { cn, formatTimecode } from "@/lib/utils";
import type { TranscriptChunk } from "@/types/meeting";

interface TranscriptViewProps {
  chunks: TranscriptChunk[];
  /** ISO timestamps of bot hand-raise events — used to highlight trigger chunks. */
  interventionTimestamps?: string[];
  /** Meeting start time; falls back to the first chunk's timestamp. */
  startedAt?: string | null;
}

interface SpeakerGroup {
  speakerLabel: string;
  items: { chunk: TranscriptChunk; index: number }[];
}

/** Groups consecutive chunks from the same speaker into chat-like blocks. */
function groupBySpeaker(chunks: TranscriptChunk[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = [];
  chunks.forEach((chunk, index) => {
    const last = groups[groups.length - 1];
    if (last && last.speakerLabel === chunk.speakerLabel) {
      last.items.push({ chunk, index });
    } else {
      groups.push({ speakerLabel: chunk.speakerLabel, items: [{ chunk, index }] });
    }
  });
  return groups;
}

/**
 * For each intervention timestamp, the trigger chunk is the latest chunk
 * spoken at or before the hand raise.
 */
function findTriggerIndices(
  chunks: TranscriptChunk[],
  interventionTimestamps: string[],
): number[] {
  const indices = new Set<number>();
  for (const iso of interventionTimestamps) {
    const target = new Date(iso).getTime();
    if (Number.isNaN(target)) continue;
    let trigger = -1;
    for (let i = 0; i < chunks.length; i++) {
      if (new Date(chunks[i].timestamp).getTime() <= target) trigger = i;
      else break;
    }
    if (trigger >= 0) indices.add(trigger);
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export function TranscriptView({
  chunks,
  interventionTimestamps = [],
  startedAt,
}: TranscriptViewProps) {
  const nextJumpRef = useRef(0);

  const baseTime = useMemo(() => {
    const base = startedAt ?? chunks[0]?.timestamp;
    const ms = base ? new Date(base).getTime() : NaN;
    return Number.isNaN(ms) ? null : ms;
  }, [startedAt, chunks]);

  const groups = useMemo(() => groupBySpeaker(chunks), [chunks]);
  const triggerIndices = useMemo(
    () => findTriggerIndices(chunks, interventionTimestamps),
    [chunks, interventionTimestamps],
  );
  const triggerSet = useMemo(() => new Set(triggerIndices), [triggerIndices]);

  const jumpToIntervention = useCallback(() => {
    if (triggerIndices.length === 0) return;
    const index = triggerIndices[nextJumpRef.current % triggerIndices.length];
    nextJumpRef.current += 1;
    document
      .getElementById(`transcript-chunk-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [triggerIndices]);

  const timecode = (iso: string): string => {
    if (baseTime === null) return "--:--:--";
    const seconds = (new Date(iso).getTime() - baseTime) / 1000;
    return formatTimecode(Math.max(0, seconds));
  };

  if (chunks.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        No transcript was captured for this meeting.
      </p>
    );
  }

  return (
    <div className="relative max-h-[70vh] overflow-y-auto">
      {triggerIndices.length > 0 && (
        <div className="sticky top-2 z-10 flex justify-end px-4">
          <button
            type="button"
            onClick={jumpToIntervention}
            className="flex items-center gap-1.5 rounded-full border border-brand-accent/30 bg-background/95 px-3 py-1.5 text-xs font-medium text-brand-accent shadow-sm backdrop-blur transition-colors hover:bg-brand-accent/10"
          >
            <Hand className="h-3.5 w-3.5" />
            Jump to bot intervention
          </button>
        </div>
      )}

      <div className="space-y-5 px-4 pb-6 pt-2">
        {groups.map((group, groupIdx) => (
          <div key={`${group.speakerLabel}-${groupIdx}`}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="rounded-full bg-brand-accent/10 px-2.5 py-0.5 text-xs font-medium text-brand-accent">
                {group.speakerLabel}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {timecode(group.items[0].chunk.timestamp)}
              </span>
            </div>

            <div className="space-y-0.5">
              {group.items.map(({ chunk, index }) => {
                const isTrigger = triggerSet.has(index);
                return (
                  <div
                    key={index}
                    id={`transcript-chunk-${index}`}
                    className={cn(
                      "grid grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-r px-2 py-1",
                      isTrigger && "border-l-2 border-brand-accent bg-brand-accent/5",
                    )}
                  >
                    <span className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {timecode(chunk.timestamp)}
                    </span>
                    <p className="font-mono text-sm leading-relaxed text-foreground">
                      {chunk.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
