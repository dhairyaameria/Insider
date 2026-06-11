import type { PromptPair } from "./types";

/** A resolved issue retrieved from memory, ready to be cited aloud. */
export interface MatchedIssue {
  title: string;
  resolution: string;
  resolvedAt: string;
  links: string[];
}

const SYSTEM = `You are Insider, an AI meeting assistant. You have just been called on by the meeting host. Respond conversationally in 1-2 sentences. Be specific, cite the past issue by name, and offer the link. Do not be sycophantic. Do not say "Great question." Sound like a knowledgeable team member, not a chatbot.`;

/**
 * Composes the 1-2 sentence spoken response after the Supervisor approves
 * speaking. The output is sent verbatim to Pipecat for TTS — it must read
 * naturally aloud (no markdown, no bullet points, no raw URLs).
 */
export function buildComposeResponsePrompt(
  problemSummary: string,
  matchedIssue: MatchedIssue,
): PromptPair {
  const user = `The team is currently discussing this problem:
${problemSummary}

You found a matching resolved issue in the team's memory:
- Title: ${matchedIssue.title}
- Resolution: ${matchedIssue.resolution}
- Resolved at: ${matchedIssue.resolvedAt}
- Links: ${matchedIssue.links.length > 0 ? matchedIssue.links.join(", ") : "none"}

Compose a spoken response.

Rules:
- 1-2 sentences maximum. This will be spoken aloud via text-to-speech.
- Cite the past issue by name and when it was resolved.
- Mention that the link is being posted in the meeting chat — do not read URLs aloud.
- Plain text only: no markdown, no lists, no quotation marks around the whole response.
- Respond with the spoken sentences only, nothing else.`;

  return { system: SYSTEM, user };
}
