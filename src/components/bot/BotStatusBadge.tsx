import { cn } from "@/lib/utils";

export type BotStatus =
  | "scheduled"
  | "joining"
  | "listening"
  | "hand_raised"
  | "speaking"
  | "ended";

const STATUS_CONFIG: Record<
  BotStatus,
  { label: string; wrapper: string; dot: string }
> = {
  scheduled: {
    label: "Scheduled",
    wrapper: "border-border bg-white text-muted-foreground",
    dot: "bg-zinc-300",
  },
  joining: {
    label: "Joining",
    wrapper: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-400",
  },
  listening: {
    label: "Listening",
    wrapper: "border-brand-accent/30 bg-brand-accent/5 text-brand-accent",
    dot: "bg-brand-accent",
  },
  hand_raised: {
    label: "Hand raised",
    wrapper: "border-brand-accent bg-brand-accent text-white",
    dot: "bg-white",
  },
  speaking: {
    label: "Speaking",
    wrapper: "border-brand-teal/40 bg-brand-teal/10 text-brand-teal",
    dot: "bg-brand-teal",
  },
  ended: {
    label: "Ended",
    wrapper: "border-border bg-zinc-50 text-muted-foreground",
    dot: "bg-zinc-400",
  },
};

/**
 * Bot state indicator. The "listening" pulse ring is the signature design
 * element: a subtle 2s ease-in-out violet oscillation. "Hand raised" snaps
 * to solid violet with a brief expand animation.
 */
export function BotStatusBadge({
  status,
  className,
}: {
  status: BotStatus;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.wrapper,
        status === "hand_raised" && "animate-hand-raise",
        className,
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {status === "listening" && (
          <span
            className="absolute inline-flex h-full w-full animate-listening-ring rounded-full bg-brand-accent"
            aria-hidden
          />
        )}
        {status === "speaking" && (
          <span
            className="absolute inline-flex h-full w-full animate-listening-ring rounded-full bg-brand-teal"
            aria-hidden
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            config.dot,
          )}
        />
      </span>
      {config.label}
    </span>
  );
}
