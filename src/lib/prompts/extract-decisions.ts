import type { PromptPair } from "./types";

export type RiskSeverity = "low" | "medium" | "high";

// Type aliases (not interfaces) so they remain assignable to the Json type
// used by the meeting_summaries JSONB columns.
export type ExtractedDecision = {
  decision: string;
  owner: string | null;
  timestamp_hint: string | null;
};

export type ExtractedActionItem = {
  task: string;
  assignee: string | null;
  due_date: string | null;
};

export type ExtractedRisk = {
  risk: string;
  severity: RiskSeverity;
};

/** Expected JSON shape of Claude's post-meeting extraction response. */
export interface ExtractDecisionsResult {
  summary: string;
  decisions: ExtractedDecision[];
  action_items: ExtractedActionItem[];
  risks: ExtractedRisk[];
}

const SYSTEM = `You are an AI that extracts structured information from engineering meeting transcripts. Be precise. Only extract things that were actually decided or assigned, not discussed.`;

/**
 * Runs post-meeting during ingestion. The response must be parsed as
 * ExtractDecisionsResult and stored in meeting_summaries.
 */
export function buildExtractDecisionsPrompt(
  transcript: string,
  meetingTitle: string,
): PromptPair {
  const user = `Here is the full transcript of the meeting "${meetingTitle}":

<transcript>
${transcript}
</transcript>

Extract the structured information below.

Return ONLY valid JSON in exactly this shape, with no other text before or after:
{
  "summary": string,
  "decisions": [{ "decision": string, "owner": string | null, "timestamp_hint": string | null }],
  "action_items": [{ "task": string, "assignee": string | null, "due_date": string | null }],
  "risks": [{ "risk": string, "severity": "low" | "medium" | "high" }]
}

Rules:
- "summary" is 2-4 sentences covering what the meeting accomplished.
- A decision must have been explicitly agreed in the transcript. Topics that were only discussed do not count.
- An action item must have been explicitly assigned or volunteered for. Use null for assignee or due_date when not stated.
- "timestamp_hint" is a short quote or speaker reference locating the decision in the transcript, or null.
- Use empty arrays when nothing qualifies. Do not invent content.`;

  return { system: SYSTEM, user };
}
