/**
 * Builds the canonical text string for embedding a memory item.
 * Not an LLM prompt — this is the input to the embedding model
 * (text-embedding-3-small), so it must be clean, deterministic plain text.
 */

export interface EmbeddingTextInput {
  title: string;
  body: string;
  tags: string[];
  sourceType: string;
}

/** ~500 tokens at the ~4 chars/token heuristic for English text. */
const MAX_EMBEDDING_CHARS = 2000;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/(\*\*|__|~~)/g, "") // bold / strikethrough
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2") // emphasis
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Concatenates a clean text string optimised for embedding:
 * "[sourceType] [title] — [body] Tags: [tags]". Markdown is stripped and
 * the result is capped at ~500 tokens (body is truncated first).
 */
export function buildEmbeddingText(item: EmbeddingTextInput): string {
  const sourceType = stripMarkdown(item.sourceType);
  const title = stripMarkdown(item.title);
  const body = stripMarkdown(item.body);
  const tags = item.tags.map((tag) => stripMarkdown(tag)).filter(Boolean);

  const prefix = `[${sourceType}] ${title} — `;
  const suffix = tags.length > 0 ? ` Tags: ${tags.join(", ")}` : "";

  const budgetForBody = Math.max(
    0,
    MAX_EMBEDDING_CHARS - prefix.length - suffix.length,
  );
  const truncatedBody =
    body.length > budgetForBody ? body.slice(0, budgetForBody).trimEnd() : body;

  return `${prefix}${truncatedBody}${suffix}`.slice(0, MAX_EMBEDDING_CHARS);
}
