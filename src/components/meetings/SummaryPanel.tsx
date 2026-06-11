import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Json, MeetingSummary } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface SummaryPanelProps {
  summary: MeetingSummary;
}

type JsonObject = Record<string, Json | undefined>;

function asObjects(json: Json): JsonObject[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (item): item is JsonObject =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function str(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

type Severity = "low" | "medium" | "high";

const SEVERITY_CLASSES: Record<Severity, string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  high: "border-red-500/30 bg-red-500/10 text-red-600",
};

function normalizeSeverity(value: Json | undefined): Severity {
  return value === "low" || value === "high" ? value : "medium";
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function SummaryPanel({ summary }: SummaryPanelProps) {
  const decisions = asObjects(summary.decisions).flatMap((o) => {
    const decision = str(o.decision);
    if (!decision) return [];
    return [
      {
        decision,
        owner: str(o.owner),
        // The extractor writes timestamp_hint; tolerate plain timestamp too.
        timestamp: str(o.timestamp_hint) ?? str(o.timestamp),
      },
    ];
  });

  const actionItems = asObjects(summary.action_items).flatMap((o) => {
    const task = str(o.task);
    if (!task) return [];
    return [{ task, assignee: str(o.assignee) }];
  });

  const risks = asObjects(summary.risks).flatMap((o) => {
    const risk = str(o.risk);
    if (!risk) return [];
    return [{ risk, severity: normalizeSeverity(o.severity) }];
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Meeting summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary text */}
        {summary.summary_text ? (
          <p className="text-base leading-relaxed">{summary.summary_text}</p>
        ) : (
          <EmptyNote>No summary text was generated.</EmptyNote>
        )}

        <Separator />

        {/* Decisions */}
        <div className="space-y-3">
          <SectionHeading>Decisions</SectionHeading>
          {decisions.length === 0 ? (
            <EmptyNote>No decisions recorded.</EmptyNote>
          ) : (
            <ul className="space-y-3">
              {decisions.map((d, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-sm">{d.decision}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.owner && (
                      <Badge variant="outline" className="font-normal">
                        {d.owner}
                      </Badge>
                    )}
                    {d.timestamp && (
                      <span className="text-xs text-muted-foreground">
                        {d.timestamp}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        {/* Action items */}
        <div className="space-y-3">
          <SectionHeading>Action items</SectionHeading>
          {actionItems.length === 0 ? (
            <EmptyNote>No action items recorded.</EmptyNote>
          ) : (
            <ul className="space-y-2.5">
              {actionItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  {/* Visual-only checkbox (v1) */}
                  <span
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border border-input"
                  />
                  <div className="min-w-0">
                    <p className="text-sm">{item.task}</p>
                    {item.assignee && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.assignee}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        {/* Risks */}
        <div className="space-y-3">
          <SectionHeading>Risks</SectionHeading>
          {risks.length === 0 ? (
            <EmptyNote>No risks flagged.</EmptyNote>
          ) : (
            <ul className="space-y-2.5">
              {risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 capitalize",
                      SEVERITY_CLASSES[r.severity],
                    )}
                  >
                    {r.severity}
                  </Badge>
                  <p className="text-sm">{r.risk}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
