import type { PromptPair } from "./types";

export type ProblemType = "blocker" | "incident" | "repeated_issue" | "risk";

/** Expected JSON shape of Claude's classification response. */
export interface ClassifyProblemResult {
  is_problem: boolean;
  problem_summary: string | null;
  confidence: number;
  problem_type: ProblemType | null;
}

const SYSTEM = `You are an AI meeting assistant analysing engineering meeting transcripts. Your only job is to identify whether the current discussion contains a blocker, incident, repeated problem, or unresolved issue that the team is spending time on. Be conservative — only flag genuine problems, not routine status updates.`;

/**
 * Runs every ~15 seconds against the rolling 90s transcript window.
 * The response must be parsed as ClassifyProblemResult.
 */
export function buildClassifyProblemPrompt(
  transcriptWindow: string,
): PromptPair {
  const user = `Here is the most recent segment of a live engineering meeting transcript:

<transcript>
${transcriptWindow}
</transcript>

Does this transcript segment contain a problem, blocker, or incident the team is stuck on?

Respond ONLY with valid JSON in exactly this shape, with no other text before or after:
{
  "is_problem": boolean,
  "problem_summary": string | null,
  "confidence": number (0-1),
  "problem_type": "blocker" | "incident" | "repeated_issue" | "risk" | null
}

Rules:
- "is_problem" is true only if the team is genuinely stuck on or spending time on an issue.
- "problem_summary" is a single self-contained sentence describing the problem, or null if is_problem is false.
- "confidence" reflects how certain you are that this is a genuine problem, from 0 to 1.
- "problem_type" is null if is_problem is false.
- Routine status updates, completed work, and casual conversation are NOT problems.`;

  return { system: SYSTEM, user };
}
