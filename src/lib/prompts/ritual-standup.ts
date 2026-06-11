import type { PromptPair } from "./types";

/** Expected JSON shape of Claude's standup kickoff response. */
export interface StandupKickoffResult {
  opening: string;
  questions: string[];
}

const SYSTEM = `You are facilitating a daily standup. Your job is to keep it to 15 minutes, surface blockers, and connect today's work to open tickets and decisions from the last sprint. You have context about the team's recent history.`;

/**
 * Builds the standup facilitator kickoff. The opening line is spoken via
 * TTS; the questions guide the Meeting agent during the ritual.
 */
export function buildStandupFacilitatorPrompt(
  teamContext: string,
  previousMeetingSummary: string | null,
): PromptPair {
  const user = `Team context:
<team_context>
${teamContext}
</team_context>

Summary of the previous meeting:
<previous_meeting>
${previousMeetingSummary ?? "No previous meeting summary is available."}
</previous_meeting>

The standup is starting. Provide a brief opening line (1 sentence) that references something relevant from the previous meeting. Then list 3 prompting questions to ask the team.

Return ONLY valid JSON in exactly this shape, with no other text before or after:
{
  "opening": string,
  "questions": string[]
}

Rules:
- "opening" is exactly one sentence, spoken aloud via text-to-speech: plain text, no markdown.
- If no previous meeting summary is available, the opening simply starts the standup without inventing history.
- "questions" contains exactly 3 short, specific questions grounded in the provided context (open tickets, blockers, decisions).
- Do not invent tickets, names, or events that are not in the provided context.`;

  return { system: SYSTEM, user };
}
