/** A system + user prompt pair ready for LLMAdapter.complete(). */
export interface PromptPair {
  system: string;
  user: string;
}
