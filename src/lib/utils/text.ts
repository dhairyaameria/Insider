export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

/**
 * Jaccard similarity over word sets — cheap deterministic "same issue?"
 * heuristic used by the Meeting agent and the Supervisor's deduplication
 * guardrail. Returns 0..1.
 */
export function summarySimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1;
  });
  return intersection / (tokensA.size + tokensB.size - intersection);
}
