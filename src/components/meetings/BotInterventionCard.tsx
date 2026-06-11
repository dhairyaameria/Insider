import { format } from "date-fns";
import { Bot, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { MemoryMatch } from "@/types/memory";

export interface BotIntervention {
  problemSummary: string;
  match: MemoryMatch;
  spokenText: string | null;
  /** ISO 8601 — when the bot raised its hand. */
  timestamp: string;
}

interface BotInterventionCardProps {
  intervention: BotIntervention;
}

export function BotInterventionCard({ intervention }: BotInterventionCardProps) {
  const { problemSummary, match, spokenText, timestamp } = intervention;
  const similarityPct = Math.round(match.similarity * 100);

  return (
    <Card className="border-brand-accent/30">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-accent text-white">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Insider raised its hand</p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(timestamp), "h:mm a")}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Problem it detected */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detected problem
          </p>
          <p className="mt-1 text-sm">{problemSummary}</p>
        </div>

        {/* The past issue it matched */}
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">{match.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Resolved {format(match.resolvedAt, "MMM d, yyyy")} ·{" "}
            <span className="font-mono tabular-nums">{similarityPct}%</span>{" "}
            match
          </p>
        </div>

        {/* What it said */}
        {spokenText && (
          <blockquote className="border-l-2 border-brand-accent/40 pl-3 text-sm italic text-foreground/90">
            &ldquo;{spokenText}&rdquo;
          </blockquote>
        )}

        {/* Links it shared */}
        {match.links.length > 0 && (
          <ul className="space-y-1">
            {match.links.map((link) => (
              <li key={link} className="flex min-w-0 items-center gap-1.5">
                <LinkIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-xs font-medium text-brand-teal hover:underline"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
