/**
 * Parses a JSON object from an LLM response, tolerating code fences and
 * surrounding prose. Returns null instead of throwing — callers must
 * degrade gracefully when the model returns malformed output.
 */
export function parseLlmJson<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
