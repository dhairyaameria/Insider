/** A resolved issue retrieved from vector memory. */
export interface MemoryMatch {
  id: string;
  title: string;
  resolution: string;
  resolvedAt: Date;
  similarity: number;
  links: string[];
  sourceType: string;
}

/** A transcript chunk hit from cross-meeting semantic search. */
export interface SearchResult {
  chunkId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  text: string;
  speakerLabel: string | null;
  startedAt: string | null;
  similarity: number;
}

/** Unified result for cross-source memory search (transcript chunks + memory items). */
export interface CombinedSearchResult {
  id: string;
  kind: "transcript" | "memory";
  title: string | null;
  text: string;
  meetingId: string | null;
  similarity: number;
  links: string[];
  resolvedAt: string | null;
}

/** A decision surfaced from memory, ranked by similarity to the query. */
export interface DecisionResult {
  id: string;
  title: string;
  body: string;
  decidedAt: string | null;
  similarity: number;
  links: string[];
}
