-- Vector similarity search functions.
-- PostgREST cannot order by `embedding <=> query` directly, so semantic
-- search goes through these SQL functions called via supabase.rpc().

-- Cross-meeting memory search (memory_items).
-- org_id filter is mandatory: team-scoped memory is non-negotiable.
CREATE OR REPLACE FUNCTION match_memory_items(
  query_embedding vector(1536),
  filter_org_id UUID,
  filter_team_id UUID DEFAULT NULL,
  filter_status TEXT DEFAULT NULL,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  team_id UUID,
  source_type TEXT,
  source_id TEXT,
  title TEXT,
  body TEXT,
  status TEXT,
  resolved_at TIMESTAMPTZ,
  tags TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    mi.id,
    mi.org_id,
    mi.team_id,
    mi.source_type,
    mi.source_id,
    mi.title,
    mi.body,
    mi.status,
    mi.resolved_at,
    mi.tags,
    mi.metadata,
    mi.created_at,
    1 - (mi.embedding <=> query_embedding) AS similarity
  FROM memory_items mi
  WHERE mi.org_id = filter_org_id
    AND (filter_team_id IS NULL OR mi.team_id = filter_team_id)
    AND (filter_status IS NULL OR mi.status = filter_status)
    AND mi.embedding IS NOT NULL
  ORDER BY mi.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Semantic search across meeting transcript chunks.
CREATE OR REPLACE FUNCTION match_meeting_chunks(
  query_embedding vector(1536),
  filter_org_id UUID,
  filter_meeting_id UUID DEFAULT NULL,
  filter_team_id UUID DEFAULT NULL,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  meeting_id UUID,
  org_id UUID,
  team_id UUID,
  speaker_label TEXT,
  text TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    mc.id,
    mc.meeting_id,
    mc.org_id,
    mc.team_id,
    mc.speaker_label,
    mc.text,
    mc.started_at,
    mc.ended_at,
    mc.created_at,
    1 - (mc.embedding <=> query_embedding) AS similarity
  FROM meeting_chunks mc
  WHERE mc.org_id = filter_org_id
    AND (filter_meeting_id IS NULL OR mc.meeting_id = filter_meeting_id)
    AND (filter_team_id IS NULL OR mc.team_id = filter_team_id)
    AND mc.embedding IS NOT NULL
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;
