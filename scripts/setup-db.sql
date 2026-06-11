-- Insider: combined database setup (migrations 001 + 002 + 003)
-- Paste into the Supabase SQL editor and run once.

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Orgs
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (mirrors Clerk)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team members
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);

-- Meetings
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  platform TEXT NOT NULL,
  external_meeting_id TEXT,
  title TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled',
  ritual_type TEXT DEFAULT 'general',
  bot_joined BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting transcript chunks
CREATE TABLE meeting_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  team_id UUID,
  speaker_label TEXT,
  text TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting summaries
CREATE TABLE meeting_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE UNIQUE,
  summary_text TEXT,
  decisions JSONB DEFAULT '[]',
  action_items JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory items (resolved issues, decisions, etc.)
CREATE TABLE memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  team_id UUID,
  source_type TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot sessions (ephemeral meeting state)
CREATE TABLE bot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE UNIQUE,
  issues_surfaced JSONB DEFAULT '[]',
  hand_raised_at TIMESTAMPTZ,
  last_spoke_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  credentials_encrypted TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, provider)
);

-- Indexes
CREATE INDEX ON meeting_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON memory_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON meetings (org_id, team_id, status);
CREATE INDEX ON memory_items (org_id, team_id, status);

-- Row-level security
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;

-- RLS policies (team-scoped: users only see their org's data)
CREATE POLICY "org_isolation_meetings" ON meetings
  FOR ALL USING (org_id = (SELECT org_id FROM users WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "org_isolation_chunks" ON meeting_chunks
  FOR ALL USING (org_id = (SELECT org_id FROM users WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "org_isolation_memory" ON memory_items
  FOR ALL USING (org_id = (SELECT org_id FROM users WHERE clerk_user_id = auth.uid()::text));

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

-- The bot.joined webhook needs the original meeting URL to spawn the
-- Pipecat sidecar bot, so persist it at scheduling time.
ALTER TABLE meetings ADD COLUMN meeting_url TEXT;
