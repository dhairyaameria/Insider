

## 8. Build plan — sequenced prompts

---

### PROMPT 01 — Project scaffold

```
You are building Insider, an AI meeting bot SaaS. analyse @insider-prd.md to get full context of the project. Then follow my step by step instructions to build this

Set up the Next.js 14 project with the following exact configuration:

1. Create a new Next.js 14 app with App Router, TypeScript, Tailwind CSS, and ESLint.
   Command: npx create-next-app@latest Insider --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"

2. Install dependencies:
   - shadcn/ui: npx shadcn@latest init
   - Clerk for auth: @clerk/nextjs
   - Supabase client: @supabase/supabase-js @supabase/ssr
   - Upstash Redis: @upstash/redis @upstash/ratelimit
   - Anthropic SDK: @anthropic-ai/sdk
   - OpenAI SDK (for embeddings only): openai
   - Zod for validation: zod
   - Date utilities: date-fns
   - shadcn components: npx shadcn@latest add button card input label select textarea badge separator skeleton avatar dropdown-menu dialog sheet toast

3. Configure Tailwind to use this design token override in tailwind.config.ts:
   - Extend colors with the brand palette:
     brand: { 900: '#0F0F0F', 800: '#1A1A2E', 700: '#16213E', accent: '#6C63FF', teal: '#00B4D8' }
     surface: '#F8F8FC'
   - Add JetBrains Mono as a font family: mono: ['JetBrains Mono', 'monospace']

4. Set up the folder structure:
   src/
     app/                    (Next.js App Router pages)
     components/
       ui/                   (shadcn components, untouched)
       layout/               (Sidebar, Header, PageShell)
       meetings/             (MeetingCard, TranscriptView, SummaryPanel)
       memory/               (SearchBar, ResultCard, DecisionList)
       bot/                  (BotStatusBadge, ListeningPulse)
     lib/
       supabase/             (client.ts, server.ts, types.ts)
       agents/               (supervisor.ts, meeting.ts, memory.ts, integration.ts)
       adapters/             (meetingbot.ts, stt.ts, tts.ts, llm.ts)
       prompts/              (all Claude prompt templates as .ts files)
       utils/                (cn.ts, format.ts, errors.ts)
     types/                  (global TypeScript types)
     hooks/                  (useSearch.ts, useMeeting.ts, useMemory.ts)

   pipecat-sidecar/          (separate Python service — NOT inside src/)
     app.py                  (FastAPI entry point)
     bot.py                  (Pipecat pipeline: VAD → STT → LLM → TTS)
     personas/               (Markdown persona files for bot personality)
     requirements.txt
     Dockerfile
     .env.example

5. Create a .env.local.example with all required environment variables:
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
   CLERK_SECRET_KEY=
   CLERK_WEBHOOK_SECRET=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ANTHROPIC_API_KEY=
   OPENAI_API_KEY=
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   MEETINGBAAS_API_KEY=
   ELEVENLABS_API_KEY=
   ELEVENLABS_VOICE_ID=
   GOOGLE_TTS_API_KEY=
   GROQ_API_KEY=
   PIPECAT_SERVICE_URL=           # URL of the Pipecat sidecar (e.g. http://localhost:8766)
   PIPECAT_SERVICE_SECRET=        # shared secret for Next.js ↔ Pipecat auth
   MEETING_BOT_PROVIDER=meetingbaas  # meetingbaas | vexa

   Also create pipecat-sidecar/.env.example:
   MEETING_BAAS_API_KEY=          # same as MEETINGBAAS_API_KEY above
   ELEVENLABS_API_KEY=
   ELEVENLABS_VOICE_ID=
   GOOGLE_TTS_API_KEY=
   GROQ_API_KEY=
   ANTHROPIC_API_KEY=
   NEXTJS_WEBHOOK_URL=            # URL of your Next.js /api/bot/webhook endpoint
   PIPECAT_SERVICE_SECRET=        # must match the value in Next.js .env

6. Set up Clerk middleware in src/middleware.ts protecting all routes except /, /login, /api/bot/webhook.

Output: A running Next.js app that compiles with no errors, with the full folder structure in place.
```

---

### PROMPT 02 — Database setup (Supabase)

```
You are building Insider. The Next.js project is already scaffolded.

Set up the Supabase database with the following steps:

1. Create src/lib/supabase/client.ts — browser-safe Supabase client using @supabase/ssr createBrowserClient.

2. Create src/lib/supabase/server.ts — server-side Supabase client using createServerClient with cookie handling for Next.js App Router.

3. Create src/lib/supabase/types.ts — TypeScript types generated from the schema (write them by hand based on the schema below, do not use supabase gen types yet).

4. Create the full database migration SQL in supabase/migrations/001_initial.sql:

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

5. Create src/lib/supabase/queries.ts with typed query helpers:
   - getMeeting(id)
   - getMeetingsByTeam(teamId, limit)
   - getMeetingChunks(meetingId)
   - searchMemoryItems(embedding, orgId, teamId?, limit)
   - upsertBotSession(meetingId, update)
   - saveMeetingChunk(chunk)
   - saveMemoryItem(item)

Output: All migration SQL and TypeScript database helpers. No Supabase dashboard clicks needed — everything is in code.
```

---

### PROMPT 03 — Adapter layer (TypeScript) + Pipecat sidecar (Python)

```
You are building Insider. The database and project scaffold are set up.

This prompt covers two things:
A. The TypeScript adapter layer in src/lib/adapters/ — interfaces that keep all vendor logic swappable
B. The Pipecat sidecar service in pipecat-sidecar/ — the Python service that handles real-time audio inside meetings

IMPORTANT DISTINCTION: Pipecat is a pipeline orchestration framework, not a TTS provider.
It manages the real-time audio loop (VAD → STT → LLM → TTS) inside the meeting.
ElevenLabs and Google TTS are the actual voice providers — Pipecat calls them at the right moment.
The flow is: MeetingBaaS WebSocket (audio in) → Pipecat → ElevenLabs TTS → MeetingBaaS WebSocket (audio out).

─────────────────────────────────────────
PART A: TypeScript adapters (src/lib/adapters/)
─────────────────────────────────────────

1. src/lib/adapters/meetingbot.ts
   This adapter handles bot JOIN/LEAVE/CHAT only. Speaking is handled by Pipecat, not this adapter.

   Define interface MeetingBotAdapter with methods:
   - joinMeeting(meetingUrl: string, botName: string, webhookUrl: string): Promise<{ botId: string }>
   - leaveMeeting(botId: string): Promise<void>
   - sendChatMessage(botId: string, message: string): Promise<void>
   Note: raiseHand() is intentionally absent — platforms don't expose this API.
   The bot signals intent via sendChatMessage("✋ Insider has a relevant note — finishing this thought first").

   Implement MeetingBaaSAdapter (concrete class) using the MeetingBaaS REST API:
   - Base URL: https://api.meetingbaas.com
   - joinMeeting: POST /bots with { meeting_url, bot_name, webhook_url, speech_to_text: { provider: 'Default' } }
   - leaveMeeting: DELETE /bots/:botId
   - sendChatMessage: POST /bots/:botId/actions with { action: 'send_message', message }
   - Handle errors with a typed BotError class

   Export getMeetingBotAdapter() factory — returns adapter based on MEETING_BOT_PROVIDER env var.

2. src/lib/adapters/pipecat.ts  ← NEW
   This adapter is how Next.js tells the Pipecat sidecar what to do.

   Define interface PipecatAdapter with:
   - spawnBot(params: { meetingUrl: string, botName: string, meetingId: string }): Promise<{ pipecatBotId: string }>
     Tells Pipecat to join a meeting and start the audio pipeline
   - triggerSpeak(pipecatBotId: string, text: string): Promise<void>
     Tells Pipecat to synthesise `text` via ElevenLabs and inject audio at the next VAD pause
   - terminateBot(pipecatBotId: string): Promise<void>
     Tells Pipecat to leave the meeting and clean up

   Implement HttpPipecatAdapter:
   - Base URL: PIPECAT_SERVICE_URL env var
   - All requests include Authorization: Bearer PIPECAT_SERVICE_SECRET header
   - spawnBot: POST /bots
   - triggerSpeak: POST /bots/:id/speak with { text }
   - terminateBot: DELETE /bots/:id

   Export getPipecatAdapter() factory.

3. src/lib/adapters/llm.ts
   Define interface LLMAdapter with:
   - complete(systemPrompt: string, userMessage: string, options?: { maxTokens?: number, temperature?: number }): Promise<string>
   - embed(text: string): Promise<number[]>

   Implement ClaudeAdapter using @anthropic-ai/sdk, model: claude-sonnet-4-20250514
   Implement OpenAIEmbedAdapter for embeddings only, model: text-embedding-3-small (1536-dim)
   Export getLLMAdapter() and getEmbedAdapter() factories.

Each TypeScript adapter must:
- Log errors with structured context (meetingId, timestamp, vendor)
- Never throw raw vendor errors — wrap in typed internal errors
- Have a 10s timeout on all network calls

─────────────────────────────────────────
PART B: Pipecat sidecar (pipecat-sidecar/)
─────────────────────────────────────────

The Pipecat sidecar is a standalone Python 3.11 FastAPI service. It runs alongside the Next.js app on a small VPS (not on Vercel). Next.js calls it via HTTP; it streams audio to/from meetings via MeetingBaaS WebSocket.

4. pipecat-sidecar/requirements.txt
   pipecat-ai>=0.0.45
   fastapi>=0.111.0
   uvicorn>=0.29.0
   python-dotenv>=1.0.0
   pydantic>=2.0.0
   httpx>=0.27.0
   loguru>=0.7.0

5. pipecat-sidecar/app.py  — FastAPI entry point
   Three endpoints:

   POST /bots
   Body: { meeting_url: str, bot_name: str, meeting_id: str }
   - Spawns a new asyncio task running a PipecatBot instance
   - Stores in a registry: { pipecat_bot_id → PipecatBot instance }
   - Returns { pipecat_bot_id: str }

   POST /bots/{pipecat_bot_id}/speak
   Body: { text: str }
   - Looks up the bot instance from registry
   - Calls bot.queue_speech(text)
   - Returns { ok: true }

   DELETE /bots/{pipecat_bot_id}
   - Calls bot.terminate()
   - Removes from registry
   - Returns { ok: true }

   All endpoints verify Authorization: Bearer PIPECAT_SERVICE_SECRET header.
   Return 401 if missing or wrong. Return 404 if bot_id not found.

6. pipecat-sidecar/bot.py  — PipecatBot class
   This is the core of the sidecar. One instance per active meeting.

   class PipecatBot:
     def __init__(self, meeting_url: str, bot_name: str, meeting_id: str):
       self.meeting_id = meeting_id
       self._speech_queue = asyncio.Queue()
       self._running = False

     async def run(self):
       """Main pipeline loop. Called as an asyncio task."""
       Configure Pipecat pipeline:
       - Transport: MeetingBaaS WebSocket transport (use pipecat's MeetingBaasTransport)
         Pass MEETING_BAAS_API_KEY and meeting_url
       - VAD: SileroVADAnalyzer — detects speech end / natural pauses
       - STT: Groq Whisper via GroqSTTService(api_key=GROQ_API_KEY, model="whisper-large-v3-turbo")
       - TTS (primary): ElevenLabsTTSService(api_key=ELEVENLABS_API_KEY, voice_id=ELEVENLABS_VOICE_ID, model="eleven_turbo_v2_5")
       - TTS (fallback): if ELEVENLABS_API_KEY not set, use GoogleTTSService(credentials=GOOGLE_TTS_API_KEY, voice="en-US-Neural2-D")

       On each final transcript chunk received from STT:
       - POST the chunk to NEXTJS_WEBHOOK_URL/api/bot/pipecat-transcript
         Body: { meeting_id, text, speaker_label, timestamp }
       - This is non-blocking (fire-and-forget HTTP call)

       On each item in _speech_queue:
       - Call TTS service to synthesise
       - Inject audio into meeting via MeetingBaaS transport

     async def queue_speech(self, text: str):
       """Called by /bots/:id/speak endpoint."""
       await self._speech_queue.put(text)

     async def terminate(self):
       """Clean up and disconnect."""
       self._running = False
       (disconnect from MeetingBaaS transport)

   Key design rule: the Pipecat bot does NOT run Claude or query memory.
   It is a dumb audio pipeline — it transcribes, forwards chunks to Next.js, and plays audio when told to.
   All intelligence (classification, memory lookup, response composition) lives in the Next.js agents.

7. pipecat-sidecar/Dockerfile
   FROM python:3.11-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install -r requirements.txt
   COPY . .
   CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8766"]

8. Update the Next.js webhook handler (src/app/api/bot/pipecat-transcript/route.ts)
   A NEW webhook route (separate from the MeetingBaaS webhook) that receives transcript chunks from Pipecat.
   - Verify PIPECAT_SERVICE_SECRET in Authorization header
   - Route chunk to the correct MeetingSession via sessionRegistry
   - Identical downstream behaviour to the existing transcript.final MeetingBaaS event

Output: All TypeScript adapter files (meetingbot.ts, pipecat.ts, llm.ts), the complete Pipecat sidecar (app.py, bot.py, requirements.txt, Dockerfile), and the new pipecat-transcript webhook route.
```

---

### PROMPT 04 — Prompt templates

```
You are building Insider. The adapter layer is complete.

Create all Claude prompt templates in src/lib/prompts/. These are TypeScript functions that return structured prompt strings. Every prompt must be deterministic — no randomness, no "be creative" instructions. These prompts are called in production.

1. src/lib/prompts/classify-problem.ts
   Function: buildClassifyProblemPrompt(transcriptWindow: string): { system: string, user: string }

   System: You are an AI meeting assistant analysing engineering meeting transcripts. Your only job is to identify whether the current discussion contains a blocker, incident, repeated problem, or unresolved issue that the team is spending time on. Be conservative — only flag genuine problems, not routine status updates.

   User: Include the transcript window. Ask: Does this transcript segment contain a problem, blocker, or incident the team is stuck on? Respond ONLY with valid JSON: { "is_problem": boolean, "problem_summary": string | null, "confidence": number (0-1), "problem_type": "blocker" | "incident" | "repeated_issue" | "risk" | null }

2. src/lib/prompts/compose-response.ts
   Function: buildComposeResponsePrompt(problemSummary: string, matchedIssue: { title: string, resolution: string, resolvedAt: string, links: string[] }): { system: string, user: string }

   System: You are Insider, an AI meeting assistant. You have just been called on by the meeting host. Respond conversationally in 1–2 sentences. Be specific, cite the past issue by name, and offer the link. Do not be sycophantic. Do not say "Great question." Sound like a knowledgeable team member, not a chatbot.

   User: The team is discussing: [problemSummary]. You found a match: [matchedIssue]. Compose a spoken response.

3. src/lib/prompts/extract-decisions.ts
   Function: buildExtractDecisionsPrompt(transcript: string, meetingTitle: string): { system: string, user: string }

   System: You are an AI that extracts structured information from engineering meeting transcripts. Be precise. Only extract things that were actually decided or assigned, not discussed.

   User: Include transcript. Return ONLY valid JSON: { "summary": string, "decisions": [{ "decision": string, "owner": string | null, "timestamp_hint": string | null }], "action_items": [{ "task": string, "assignee": string | null, "due_date": string | null }], "risks": [{ "risk": string, "severity": "low" | "medium" | "high" }] }

4. src/lib/prompts/ritual-standup.ts
   Function: buildStandupFacilitatorPrompt(teamContext: string, previousMeetingSummary: string | null): { system: string, user: string }

   System: You are facilitating a daily standup. Your job is to keep it to 15 minutes, surface blockers, and connect today's work to open tickets and decisions from the last sprint. You have context about the team's recent history.

   User: Include team context and last meeting summary. The standup is starting. Provide a brief opening line (1 sentence) that references something relevant from the previous meeting. Then list 3 prompting questions to ask the team. Return JSON: { "opening": string, "questions": string[] }

5. src/lib/prompts/generate-embedding-text.ts
   Function: buildEmbeddingText(item: { title: string, body: string, tags: string[], sourceType: string }): string

   Concatenates a clean text string optimised for embedding: "[sourceType] [title] — [body] Tags: [tags]". Strips markdown, keeps under 500 tokens.

Output: All five prompt template files with full TypeScript types.
```

---

### PROMPT 05 — Memory agent

```
You are building Insider. Adapters and prompts are complete.

Build the Memory agent in src/lib/agents/memory.ts.

This agent is stateless — it receives a request, queries pgvector, and returns results. It also handles ingestion (writing new items to memory).

Implement the following exported async functions:

1. findSimilarResolvedIssues(params: {
     problemSummary: string
     orgId: string
     teamId?: string
     limit?: number       // default 3
     minSimilarity?: number  // default 0.78
   }): Promise<MemoryMatch[]>

   Steps:
   a. Embed the problemSummary using getEmbedAdapter().embed()
   b. Query pgvector: SELECT id, title, body, metadata, resolved_at, 1 - (embedding <=> $1) AS similarity FROM memory_items WHERE org_id = $2 AND status = 'resolved' AND (team_id = $3 OR $3 IS NULL) AND 1 - (embedding <=> $1) > $4 ORDER BY similarity DESC LIMIT $5
   c. Map to MemoryMatch type: { id, title, resolution: string, resolvedAt: Date, similarity: number, links: string[], sourceType: string }
   d. Return empty array if no matches (never throw)

2. ingestMeeting(params: {
     meetingId: string
     orgId: string
     teamId: string
     transcript: string
     summary: MeetingSummary
   }): Promise<void>

   Steps:
   a. Chunk the transcript into ~200-word segments with 50-word overlap
   b. For each chunk: embed → save to meeting_chunks table
   c. For each decision in summary.decisions: create a memory_item with source_type='meeting', status='resolved' (decisions are resolved by definition), embed title+decision text, save
   d. For each resolved action item: create memory_item
   e. Run in parallel with Promise.all where safe, sequential where order matters

3. ingestTicket(params: {
     orgId: string
     teamId: string
     ticket: { id: string, title: string, description: string, status: string, resolvedAt?: Date, url: string }
   }): Promise<void>

   Steps:
   a. Build embedding text using buildEmbeddingText()
   b. Embed
   c. Upsert to memory_items (use source_id = ticket.id to deduplicate)

4. searchMeetings(params: {
     query: string
     orgId: string
     teamId?: string
     limit?: number
   }): Promise<SearchResult[]>

   Embeds query, searches meeting_chunks by cosine similarity, returns top results with meeting metadata joined.

5. getDecisionHistory(params: {
     query: string
     orgId: string
     teamId?: string
   }): Promise<DecisionResult[]>

   Searches memory_items where source_type='meeting' and title contains decision-related keywords, ranked by similarity to query.

Define all TypeScript types in src/types/memory.ts.

Error handling: all functions catch errors internally and log them. Never let an ingestion error propagate to the caller — log and continue.

Output: Complete memory agent with all five functions, types, and internal error handling.
```

---

### PROMPT 06 — Meeting agent

```
You are building Insider. The memory agent is complete.

Build the Meeting agent in src/lib/agents/meeting.ts.

This agent runs inside an active meeting session. It is stateful — it holds the rolling transcript window and session state in memory (and syncs to Redis for durability).

Implement:

1. MeetingSession class
   Constructor: (meetingId: string, orgId: string, teamId: string, ritualType: RitualType)
   
   Private state:
   - transcriptWindow: TranscriptChunk[]  // last ~90 seconds
   - sessionState: BotSessionState        // synced to Redis
   - lastClassifiedAt: number             // timestamp of last classification run
   - classificationIntervalMs: 15000      // run every 15s

   Public methods:

   a. addChunk(chunk: TranscriptChunk): Promise<void>
      - Append chunk to transcriptWindow
      - Trim window to keep only last 90 seconds
      - Persist chunk to Supabase meeting_chunks (non-blocking, fire and forget)
      - If time since lastClassifiedAt > classificationIntervalMs: call _classifyWindow()

   b. _classifyWindow(): Promise<void>  (private)
      - Concatenate transcriptWindow text
      - Call getLLMAdapter().complete() with buildClassifyProblemPrompt()
      - Parse JSON response
      - If is_problem && confidence > 0.7: call _handleProblemDetected(problem_summary, problem_type)

   c. _handleProblemDetected(problemSummary: string, problemType: string): Promise<void>  (private)
      - Call memory agent findSimilarResolvedIssues()
      - If no matches: log and return
      - Check sessionState.issues_surfaced: if this issue was already raised (by similarity of problem_summary), return
      - Check sessionState.last_spoke_at: if bot spoke < 60s ago, queue instead of immediate raise
      - Otherwise: update sessionState.issues_surfaced, call Supervisor agent with the match

   d. onReadyToSpeak(): Promise<SpeakResponse>
      - A match has been found and the Supervisor has decided to speak
      - Retrieve the pending match from sessionState
      - Call getLLMAdapter().complete() with buildComposeResponsePrompt()
      - Return { text: string, links: string[] }
      - Note: does NOT call TTS directly — that is handled by Pipecat via getPipecatAdapter().triggerSpeak()

   e. endSession(): Promise<MeetingSummary>
      - Stop classification loop
      - Concatenate full transcript
      - Call getLLMAdapter().complete() with buildExtractDecisionsPrompt()
      - Parse and return MeetingSummary
      - Trigger memory agent ingestMeeting() (non-blocking)

2. RitualType enum: 'standup' | 'planning' | 'incident_review' | 'general'

3. detectRitualType(meetingTitle: string): RitualType
   Simple keyword detection: if title contains 'standup' or 'stand-up' or 'daily' → standup. If 'planning' or 'sprint' → planning. If 'incident' or 'postmortem' or 'RCA' → incident_review. Else → general.

4. Session registry: a Map<meetingId, MeetingSession> singleton so the webhook handler can find the right session.

Define types in src/types/meeting.ts.

Output: Complete MeetingSession class, ritual detection, session registry, and all TypeScript types.
```

---

### PROMPT 07 — Supervisor agent

```
You are building Insider. The Meeting and Memory agents are complete.

Build the Supervisor agent in src/lib/agents/supervisor.ts.

The Supervisor is the orchestrator. It sits between agents and enforces guardrails. In v1 it is a stateless routing layer. In v2 it will grow into a Claude tool-calling loop.

Implement:

1. SupervisorAgent class (singleton)

   shouldRaiseHand(params: {
     meetingId: string
     problemSummary: string
     match: MemoryMatch
     sessionState: BotSessionState
   }): boolean

   Guardrails (return false if any fail):
   - match.similarity < 0.78 → false
   - sessionState.issues_surfaced already contains an item where similarity(item.problemSummary, problemSummary) > 0.85 → false (deduplicate similar problems)
   - sessionState.hand_raised_at is set and Date.now() - hand_raised_at < 30000 → false (already raised hand in last 30s)
   - match.resolvedAt is older than 180 days → false (stale resolution)
   - Return true

   async handleProblemMatch(params: {
     meetingId: string
     botId: string
     pipecatBotId: string
     problemSummary: string
     match: MemoryMatch
     session: MeetingSession
   }): Promise<void>

   Steps:
   a. Call shouldRaiseHand() — return if false
   b. Update bot session: set hand_raised_at, add to issues_surfaced
   c. Call meetingBotAdapter.sendChatMessage(botId, "✋ Insider has a relevant note — finishing this thought first")
      This is the platform-agnostic signal to the team (Zoom/Meet/Teams all support chat)
   d. Call session.onReadyToSpeak() → { text, links }
   e. Call getPipecatAdapter().triggerSpeak(pipecatBotId, text)
      Pipecat will synthesise via ElevenLabs and inject audio at the next VAD pause
   f. Log: { event: 'spoke', meetingId, matchId: match.id, similarity: match.similarity, text }
   g. Store pending links in session state for chat follow-up

   async handleReadyToSpeak(params: {
     meetingId: string
     botId: string
     pipecatBotId: string
     session: MeetingSession
   }): Promise<void>

   Steps:
   a. Call session.onReadyToSpeak() → { text, links }
   b. Call getPipecatAdapter().triggerSpeak(pipecatBotId, text)
      Pipecat handles ElevenLabs TTS synthesis and audio injection — no audio handling here
   c. Update session: set last_spoke_at
   d. Call integrationAgent.postLinksToChat(botId, links)
   e. Log: { event: 'spoke', meetingId, text }

   async handleMeetingEnd(params: {
     meetingId: string
     session: MeetingSession
     orgId: string
     teamId: string
   }): Promise<void>

   Steps:
   a. Call session.endSession() → summary
   b. Save summary to meeting_summaries table
   c. Call integrationAgent.postSummaryToSlack() if Slack is connected
   d. Trigger memory ingestion (non-blocking)
   e. Clean up session registry

2. Export a singleton: export const supervisor = new SupervisorAgent()

Output: Complete SupervisorAgent class with all three handler methods and guardrail logic.
```

---

### PROMPT 08 — Integration agent

```
You are building Insider. The core agents are complete.

Build the Integration agent in src/lib/agents/integration.ts.

This is the only agent that calls external APIs (Jira, Linear, Slack, Notion, Google Calendar). All other agents route through this one for external writes.

Implement IntegrationAgent class with:

1. async postLinksToChat(botId: string, links: { label: string, url: string }[]): Promise<void>
   - Formats links as a clean text message: "Related: [label](url), [label](url)"
   - Calls meetingBotAdapter.sendChatMessage()

2. async postSummaryToSlack(params: {
     orgId: string
     summary: MeetingSummary
     meetingTitle: string
     meetingId: string
   }): Promise<void>
   - Fetches Slack integration credentials from integrations table
   - If not connected: log and return
   - Formats a Slack Block Kit message with: meeting title, summary text, decisions list, action items list
   - POST to Slack incoming webhook URL from credentials
   - Handle Slack API errors gracefully

3. async createTicketFromActionItem(params: {
     orgId: string
     actionItem: { task: string, assignee: string | null }
     projectId: string
     platform: 'jira' | 'linear'
   }): Promise<{ ticketId: string, url: string } | null>
   - Fetch platform credentials from integrations table
   - If Jira: POST /rest/api/3/issue with summary and assignee
   - If Linear: POST to Linear GraphQL API with createIssue mutation
   - Return ticket ID and URL, or null on failure

4. async fetchCalendarMeetings(params: {
     orgId: string
     userId: string
     dateRange: { start: Date, end: Date }
   }): Promise<CalendarMeeting[]>
   - Fetch Google Calendar integration credentials
   - GET /calendar/v3/calendars/primary/events with timeMin, timeMax
   - Map to CalendarMeeting type: { id, title, startTime, endTime, meetingUrl, attendees }
   - Extract meeting URL from location field or conferenceData.entryPoints

5. async syncTicketsToMemory(params: {
     orgId: string
     teamId: string
     platform: 'jira' | 'linear'
     projectId: string
   }): Promise<number>  // returns count of synced tickets
   - Fetch all resolved/done tickets from last 90 days
   - For each ticket: call memoryAgent.ingestTicket()
   - Return count

Define types in src/types/integrations.ts.

For all API calls: 10s timeout, structured error logging, never throw to caller.

Output: Complete IntegrationAgent class with all five methods.
```

---

### PROMPT 09 — Webhook handler (the real-time backbone)

```
You are building Insider. All four agents are complete.

Build the MeetingBaaS webhook handler in src/app/api/bot/webhook/route.ts.

This is the most important API route — it receives real-time events from the meeting bot and drives the entire agent system.

MeetingBaaS sends POST requests with these event types:
- bot.joined — bot successfully joined the meeting
- bot.left — bot left the meeting  
- transcript.partial — a partial transcript chunk (speaker + text)
- transcript.final — a final/confirmed transcript chunk
- meeting.ended — meeting has ended

Note: transcript chunks now arrive via TWO sources:
1. MeetingBaaS webhook (transcript.final events) — used as a backup / for recording
2. Pipecat sidecar webhook (POST /api/bot/pipecat-transcript) — primary real-time source

The Pipecat transcript route is already built in Prompt 03. This webhook handles the MeetingBaaS events.

Implement the MeetingBaaS webhook route handler:

export async function POST(request: Request) {

1. Verify the request is from MeetingBaaS:
   - Check X-MeetingBaaS-Signature header (HMAC SHA-256 of body with MEETINGBAAS_WEBHOOK_SECRET)
   - Return 401 if invalid

2. Parse the event body: { event: string, botId: string, meetingId: string, data: any }

3. Look up the internal meeting record by external botId

4. Route by event type:
   
   case 'bot.joined':
     - Update meetings table: bot_joined = true, status = 'active', started_at = now
     - Create a new MeetingSession in the session registry
     - Detect ritual type from meeting title
     - Spawn Pipecat bot: call getPipecatAdapter().spawnBot({ meetingUrl, botName, meetingId })
     - Store pipecatBotId alongside botId in the session state
     - Log: { event: 'bot_joined', meetingId, botId, pipecatBotId }

   case 'transcript.final':
     - This is now a BACKUP path only (Pipecat is the primary transcript source)
     - Get session from registry
     - If no session: log warning, return 200
     - If chunk already received from Pipecat (deduplicate by timestamp): skip
     - Otherwise: route to session.addChunk() as normal

   case 'meeting.ended':
     - Get session from registry
     - Await supervisor.handleMeetingEnd({ meetingId, session, orgId, teamId })
     - Call getPipecatAdapter().terminateBot(session.pipecatBotId)
     - Update meetings table: status = 'completed', ended_at = now

5. Always return Response.json({ ok: true }, { status: 200 })
   - Never return 5xx to MeetingBaaS — it will retry. Handle all errors internally.

Also build the companion route POST /api/meetings/route.ts:
- Auth with Clerk
- Accepts { meetingUrl, title, teamId, scheduledAt }
- Creates a meetings record
- Calls meetingBotAdapter.joinMeeting() with the webhook URL
- Stores the botId as external_meeting_id
- Returns the created meeting

Output: Complete webhook handler and meeting creation route with full error handling.
```

---

### PROMPT 10 — Search API and memory API routes

```
You are building Insider. The webhook handler is complete.

Build the memory and search API routes.

1. POST /api/memory/search — src/app/api/memory/search/route.ts
   Auth: Clerk (required)
   Body: { query: string, teamId?: string, limit?: number }
   
   Steps:
   a. Get orgId from current user (query users table by clerk_user_id)
   b. Call memoryAgent.searchMeetings()
   c. Also call memoryAgent.findSimilarResolvedIssues() with minSimilarity 0.7 for broader results
   d. Merge, deduplicate, sort by similarity
   e. Return: { results: SearchResult[], query: string, totalCount: number }

2. GET /api/memory/decisions — src/app/api/memory/decisions/route.ts
   Auth: Clerk
   Query params: query, teamId, limit
   Returns decision history from memoryAgent.getDecisionHistory()

3. GET /api/meetings/:id — src/app/api/meetings/[id]/route.ts
   Auth: Clerk
   Returns meeting with summary, action items, decisions joined
   Include bot_session data

4. GET /api/meetings/:id/transcript — src/app/api/meetings/[id]/transcript/route.ts
   Auth: Clerk
   Returns all meeting_chunks ordered by started_at
   Groups by speaker_label

5. POST /api/meetings/:id/search — src/app/api/meetings/[id]/search/route.ts
   Auth: Clerk
   Body: { query: string }
   Semantic search within a single meeting's chunks

6. GET /api/auth/webhook — src/app/api/auth/webhook/route.ts (Clerk webhook)
   Verify Clerk webhook signature (use svix library)
   Handle user.created: create user record in users table
   Handle organization.created: create org + default team
   Handle organizationMembership.created: create team_member record
   Return 200

All routes must:
- Return consistent error shapes: { error: string, code: string }
- Use Supabase service role key for server-side queries (bypasses RLS where needed for joins)
- Include request logging with timing

Output: All six API route files with full TypeScript types and error handling.
```

---

### PROMPT 11 — Dashboard and layout (frontend)

```
You are building Insider. The backend is complete. Now build the frontend.

Design system reminder:
- Colors: brand-accent #6C63FF (violet), brand-800 #1A1A2E (nav), surface #F8F8FC (bg), text-primary #111827
- Fonts: Inter for UI, JetBrains Mono for transcripts/code
- Components: shadcn/ui with brand token overrides
- Feel: Linear-meets-Vercel — dense, precise, trustworthy. Not bubbly.

Build the core layout and dashboard:

1. src/components/layout/Sidebar.tsx
   Fixed 240px left sidebar with:
   - Insider logo + org name at top
   - Nav links: Dashboard, Meetings, Search, Settings
   - Active state: brand-accent left border + light violet bg
   - At bottom: current user avatar + name (from Clerk useUser())
   - Collapses to icon-only on mobile

2. src/components/layout/PageShell.tsx
   Wrapper component: sidebar + main content area with correct padding.
   Used by all authenticated pages.

3. src/app/(dashboard)/layout.tsx
   Authenticated layout using Clerk's auth().protect()
   Wraps children in PageShell

4. src/app/(dashboard)/dashboard/page.tsx
   The main dashboard. Sections:
   
   a. "This week" header with date range
   
   b. Stats row (3 cards):
      - Meetings this week (count)
      - Issues surfaced (count of times bot raised hand)
      - Decisions logged (count from memory_items)
   
   c. "Recent meetings" table:
      Columns: Title, Team, Date, Ritual type, Bot status (joined/not), Issues surfaced
      Link to /meetings/[id] on row click
   
   d. "Recent decisions" list:
      Last 5 decisions from memory_items, with source meeting link
   
   Fetch data with server components (async page component querying Supabase directly).

5. src/components/bot/BotStatusBadge.tsx
   Shows bot status: scheduled | joining | listening | hand raised | speaking | ended
   
   "listening" state: small violet pulse ring animation (this is the signature design element).
   Use CSS @keyframes for the pulse — a subtle 2s ease-in-out opacity oscillation on a ring element.
   "hand raised" state: solid violet circle, brief scale-up animation on transition.
   
   This component is used in meeting cards and the meeting detail page.

Output: All five files — Sidebar, PageShell, dashboard layout, dashboard page, BotStatusBadge with the pulse animation.
```

---

### PROMPT 12 — Meeting detail page

```
You are building Insider. The dashboard is built.

Build the meeting detail page at /meetings/[id].

src/app/(dashboard)/meetings/[id]/page.tsx — server component that fetches meeting data.
src/components/meetings/ — all child components.

Layout: two-column. Left (60%): transcript. Right (40%): summary panel, decisions, action items.

1. TranscriptView component (src/components/meetings/TranscriptView.tsx)
   Props: chunks: TranscriptChunk[]
   
   Renders transcript as a chat-like view:
   - Group consecutive chunks from the same speaker
   - Speaker label pill (e.g. "Speaker 1") in brand-accent on first chunk of group
   - Timestamp (HH:MM:SS) in muted text
   - Transcript text in JetBrains Mono, 14px, text-primary
   - If a chunk was the trigger for a bot raise-hand event: highlight it with a subtle violet left border
   - Sticky "Jump to bot intervention" button if there were interventions

2. SummaryPanel component (src/components/meetings/SummaryPanel.tsx)
   Props: summary: MeetingSummary
   
   Sections (accordion or always-open):
   - Summary text (prose, 16px)
   - Decisions list: each with decision text, owner badge, timestamp
   - Action items: each with checkbox (visual only, v1), task text, assignee
   - Risks: each with severity badge (low/medium/high coloured)

3. BotInterventionCard component (src/components/meetings/BotInterventionCard.tsx)
   Props: intervention: { problemSummary, match: MemoryMatch, spokenText, timestamp }
   
   Card showing:
   - "Insider raised its hand" header with violet bot avatar
   - Problem it detected (from problemSummary)
   - The past issue it matched (title, resolved date, similarity score as %)
   - What it said (spoken text in italics)
   - Links it shared

4. Meeting page itself: fetches meeting, transcript chunks, summary, bot session from API routes. Passes to components. Shows loading skeletons during fetch. Shows "Bot did not join this meeting" state if bot_joined is false.

Output: TranscriptView, SummaryPanel, BotInterventionCard, and the meeting detail page.
```

---

### PROMPT 13 — Search UI

```
You are building Insider. Meeting detail is built.

Build the search page at /search — the cross-meeting semantic search UI.

src/app/(dashboard)/search/page.tsx — client component (needs interactivity).
src/components/memory/ — child components.

1. SearchBar component (src/components/memory/SearchBar.tsx)
   - Large input, placeholder: "Ask anything... e.g. when did we last discuss migrating off Redis?"
   - Violet search icon on the right
   - Submits on Enter or button click
   - Shows a subtle loading spinner inside the input while searching
   - Clears with × button when populated

2. ResultCard component (src/components/memory/ResultCard.tsx)
   Props: result: SearchResult (which includes: text snippet, source meeting title, date, similarity, sourceType icon)
   
   Card design:
   - Source type icon (meeting transcript / ticket / decision) in small pill
   - Snippet text with the matching phrase highlighted (bold)
   - Meeting title + date in muted text at bottom
   - Similarity score as a thin coloured bar (higher = more violet)
   - Click expands to show full chunk text

3. DecisionList component (src/components/memory/DecisionList.tsx)
   Props: decisions: DecisionResult[]
   Timeline-style list of decisions, grouped by month.
   Each item: decision text, source meeting link, owner, date.

4. Search page itself:
   - SearchBar at the top
   - Below: two tabs — "All results" and "Decisions only"
   - "All results": grid of ResultCards
   - "Decisions only": DecisionList
   - Empty state: "Ask a question about your team's history" with 3 example queries as clickable chips
   - Error state: "Search failed — try a different query"
   - Uses SWR or direct fetch with useTransition for smooth loading

Output: SearchBar, ResultCard, DecisionList, and the search page.
```

---

### PROMPT 14 — Onboarding flow

```
You are building Insider. Core pages are built.

Build the onboarding wizard at /onboarding. This is a new user's first experience — it must be frictionless. Goal: get a team from sign-up to bot joining their first meeting in under 10 minutes.

src/app/(onboarding)/onboarding/page.tsx — multi-step wizard (client component).

Steps (show progress indicator: step X of 4):

Step 1 — Name your workspace
- Input: workspace name
- Auto-suggests from user's email domain
- Confirm button

Step 2 — Connect your calendar
- Big "Connect Google Calendar" button (OAuth)
- "Connect Microsoft Calendar" button (OAuth)
- Skip option (can configure later)
- Shows connected state with green checkmark + calendar name

Step 3 — Connect your first project tool
- Cards for: Jira, Linear, GitHub
- Click any → OAuth flow in modal
- Skip option
- Shows connected state

Step 4 — Invite the bot to a meeting
- "Schedule Insider for a meeting" section
- Input: paste a meeting URL (Zoom/Meet/Teams)
- Optional: meeting title
- "Join now" button — calls POST /api/meetings
- Shows BotStatusBadge in "joining" state while waiting
- On bot.joined webhook event (poll /api/meetings/:id every 3s): shows success state
- "Go to dashboard" button

Also build:
src/app/(onboarding)/layout.tsx — minimal layout (no sidebar, centred content, Insider logo top left).

The onboarding wizard should feel fast and reassuring. Each step is one clear action. No walls of text.

Output: Full onboarding wizard with all 4 steps, layout, and polling logic.
```

---

### PROMPT 15 — Settings pages

```
You are building Insider. Onboarding is built.

Build the settings section at /settings.

1. /settings/integrations — src/app/(dashboard)/settings/integrations/page.tsx
   
   Grid of integration cards. Each card:
   - Provider logo placeholder (coloured icon with first letter)
   - Provider name and description
   - Status: "Connected" (green) or "Not connected" (gray)
   - Connect button (triggers OAuth) or Disconnect button
   - For connected integrations: show last synced time
   
   Providers: Zoom, Google Meet, Microsoft Teams, Jira, Linear, GitHub, Slack, Notion, Google Calendar

2. /settings/team — src/app/(dashboard)/settings/team/page.tsx
   
   Sections:
   
   a. "Bot behaviour" 
      - Auto-join toggle: "Automatically join all meetings" (default: off)
      - Auto-join filter: text input for meeting title keywords that trigger auto-join (e.g. "standup, planning")
      - Similarity threshold slider: 0.70 → 0.95 (default 0.78). Label: "How confident should the bot be before raising its hand?"
      - Show a tooltip explaining what this means in plain English
   
   b. "Memory scope"
      - Toggle: "Share memory across teams in org" (default: off — team-scoped)
      - Data retention: dropdown — 30 days / 90 days / 1 year / Forever
   
   c. "Bot identity"
      - Bot display name input (default: "Insider PM")
   
   Save button at bottom. PATCH to /api/teams/:id/settings.

3. API routes for settings:
   GET /api/teams/:id/settings — src/app/api/teams/[id]/settings/route.ts
   PUT /api/teams/:id/settings — update team config in Supabase teams table config JSONB column

Output: Both settings pages and their API routes.
```

---

### PROMPT 16 — Post-meeting summary job

```
You are building Insider. All pages are built.

Build the post-meeting processing pipeline. This runs after a meeting ends and does the heavy lifting: generate summary, extract decisions, ingest everything to memory.

1. src/lib/jobs/process-meeting.ts
   
   Exported function: processMeeting(meetingId: string): Promise<void>
   
   This is called by supervisor.handleMeetingEnd() and can also be triggered manually.
   
   Steps:
   a. Fetch all meeting_chunks for the meeting, ordered by started_at
   b. Concatenate into full transcript string (with speaker labels: "Speaker 1: [text]\n")
   c. If transcript is > 100k characters: chunk into 50k-char segments with overlap, summarise each, then summarise the summaries (map-reduce pattern)
   d. Call getLLMAdapter().complete() with buildExtractDecisionsPrompt() on the full transcript
   e. Parse the JSON response (wrap in try/catch — LLMs occasionally produce invalid JSON; retry once with a stricter prompt if parse fails)
   f. Save to meeting_summaries table
   g. For each decision: create memory_item (source_type: 'meeting', status: 'resolved')
   h. For each action item with an assignee: optionally create a ticket via integrationAgent (only if Jira/Linear is connected and auto-create-tickets setting is on)
   i. Call memoryAgent.ingestMeeting() to embed all chunks
   j. Log completion: { meetingId, decisionsCount, actionItemsCount, chunksIngested }

2. Retry logic:
   - Wrap the entire job in a try/catch
   - On failure: update meeting status to 'processing_failed', log error with full context
   - Do not retry automatically in v1 — log clearly so it can be triggered manually

3. Manual trigger API route: POST /api/meetings/:id/process
   Auth: Clerk (admin only)
   Calls processMeeting(id)
   Returns { ok: true, summary: MeetingSummary }

Output: Complete processMeeting job, error handling, and the manual trigger route.
```

---

### PROMPT 17 — End-to-end test: bot joining a meeting

```
You are building Insider. All components are built.

Write an end-to-end test for the core flow: bot joins a meeting, receives a transcript, detects a problem, raises hand, and speaks.

Use Vitest for unit tests and the built-in Next.js test utilities.

1. src/tests/agents/meeting-agent.test.ts
   
   Test: "detects a blocker in transcript window and triggers hand raise"
   
   Setup:
   - Mock getLLMAdapter() to return { is_problem: true, problem_summary: "Redis connection keeps timing out", confidence: 0.88, problem_type: "blocker" }
   - Mock getEmbedAdapter() to return a fixed 1536-dimensional vector
   - Mock Supabase queries to return a matching memory_item (resolved Redis issue from 45 days ago)
   - Mock meetingBotAdapter.raiseHand() to track calls
   
   Create a MeetingSession, add 10 transcript chunks that describe a Redis timeout issue.
   Advance the mock clock by 16 seconds (past the 15s classification interval).
   Assert: raiseHand() was called exactly once.
   
   Test: "does not raise hand twice for the same issue"
   Same setup, but add a second batch of similar chunks after the first raise.
   Assert: raiseHand() was called exactly once total.

2. src/tests/agents/memory-agent.test.ts
   
   Test: "findSimilarResolvedIssues returns correctly filtered results"
   Mock Supabase to return 3 items: one with similarity 0.85 (resolved), one with similarity 0.80 (open), one with similarity 0.65 (resolved).
   Call findSimilarResolvedIssues with minSimilarity 0.78.
   Assert: only the resolved item with similarity 0.85 is returned.

3. src/tests/api/webhook.test.ts
   
   Test: "webhook handler processes transcript.final event correctly"
   Mock the HMAC signature verification to pass.
   POST a transcript.final event to the handler.
   Assert: session.addChunk() was called with correct chunk data.
   Assert: response is 200 { ok: true }.
   
   Test: "webhook handler returns 200 even when session is not found"
   POST a transcript.final event for an unknown meetingId.
   Assert: response is 200 (no 5xx retries from MeetingBaaS).

Output: Three test files covering the core flow.
```

---

### PROMPT 18 — Deployment and environment setup

```
You are building Insider. The app is complete and tested.

Prepare everything for deployment.

1. vercel.json
   {
     "framework": "nextjs",
     "regions": ["iad1"],
     "env": {
       "NEXT_PUBLIC_APP_URL": "https://Insider.vercel.app"
     }
   }

2. .github/workflows/deploy.yml
   Trigger: push to main
   Steps:
   - Checkout
   - Setup Node 20
   - Install deps (npm ci)
   - Run type check (npm run type-check)
   - Run tests (npm run test)
   - Deploy to Vercel (use VERCEL_TOKEN secret)

3. .github/workflows/pr.yml
   Trigger: pull_request
   Steps: type-check + test only (no deploy)

4. src/lib/utils/errors.ts — standardised error classes:
   class InsiderError extends Error { constructor(public code: string, message: string, public context?: object) }
   class BotError extends InsiderError {}
   class MemoryError extends InsiderError {}
   class IntegrationError extends InsiderError {}

5. src/lib/utils/logger.ts — structured logger:
   Uses console.log with JSON formatting in production, pretty-print in dev.
   Every log must include: { timestamp, level, service, ...context }
   Export: logger.info(), logger.warn(), logger.error()

6. README.md — complete setup guide:
   - Prerequisites (Node 20, Python 3.11, Supabase account, Clerk account, MeetingBaaS account)
   - Environment variable setup (reference .env.local.example and pipecat-sidecar/.env.example)
   - Database migration steps (npx supabase db push)
   - Running the Pipecat sidecar locally: cd pipecat-sidecar && pip install -r requirements.txt && uvicorn app:app --port 8766
   - Local development (npm run dev in root, sidecar in separate terminal)
   - Using ngrok for local webhook testing: ngrok http 3000 (Next.js) + ngrok http 8766 (Pipecat)
   - Running tests (npm run test)
   - First meeting walkthrough (paste a Google Meet URL → bot joins → Pipecat spawns → bot speaks)

7. Add these scripts to package.json:
   "type-check": "tsc --noEmit"
   "test": "vitest run"
   "test:watch": "vitest"
   "db:migrate": "npx supabase db push"

Output: vercel.json, two GitHub Actions workflows, error classes, logger, and README.
```

---

### PROMPT 19 — Beta user onboarding materials

```
You are building Insider. The app is deployed.

Create materials to onboard the first 5–10 beta engineering teams.

1. docs/beta-setup-guide.md
   A clear, friendly guide for a team lead setting up Insider for their team.
   Sections:
   - What Insider does (2 sentences)
   - What you need (Zoom/Meet/Teams account, Jira or Linear, Slack)
   - Step-by-step setup (numbered, no jargon)
   - How to invite the bot to a standup
   - What to expect in the first week
   - How to give feedback (link to a feedback form)
   - Known limitations in v1 (honest: Teams support is limited, bot speaks English only, memory search works best after 5+ meetings)

2. docs/feedback-template.md
   A structured feedback form for beta users (to be sent weekly):
   
   Questions:
   1. Did the bot surface any useful past issues this week? (Yes / No / It joined but didn't surface anything)
   2. If yes: describe one instance where it was helpful.
   3. If no: describe a moment where it should have raised its hand but didn't.
   4. Did the bot surface any false positives (raised its hand for something irrelevant)? How many?
   5. How would you rate the voice quality? (1–5)
   6. How would you rate the meeting summaries? (1–5)
   7. What is the one thing you'd most want to improve?
   8. Would you recommend Insider to another engineering team? (Yes / No / Maybe)
   9. Any other notes?

3. docs/metrics-to-track.md
   A dashboard of metrics to review weekly during beta:
   
   Activation:
   - Teams with ≥1 meeting with bot this week
   - Average meetings per active team per week
   
   Core value delivery:
   - % of meetings where bot raised hand ≥1 time
   - Total issues surfaced per week
   - False positive rate (issues raised / issues confirmed useful via feedback)
   
   Memory quality:
   - Total memory items ingested (meetings + tickets)
   - Search queries per week
   - Click-through rate on search results
   
   Reliability:
   - Bot join success rate (bot.joined events / POST /api/meetings calls)
   - Webhook processing error rate
   - STT failure rate
   
   Target for end of beta (week 8):
   - 5+ active teams (≥3 meetings/week)
   - Bot surfaces at least 1 relevant issue in >40% of meetings
   - NPS ≥7 on "does this save you time?"

Output: Three markdown documents.
```

---

### PROMPT 20 — v1.1 migration: swap MeetingBaaS for Vexa

```
You are building Insider. v1 is live with real users.

Now migrate the meeting bot layer from MeetingBaaS to Vexa (self-hosted, open-source) to eliminate the $99/month dependency and unlock the self-hosted enterprise story.

Context: Vexa is an open-source meeting bot API (https://github.com/Vexa-ai/vexa). It supports Google Meet currently. The adapter pattern was built exactly for this migration.

1. Set up Vexa:
   - Clone the Vexa repo and deploy it on a $20/month Hetzner or DigitalOcean VPS (Ubuntu 22.04, 4GB RAM)
   - Vexa uses Docker Compose — document the exact commands to run
   - Configure Vexa to point its webhook to your Next.js app at /api/bot/webhook
   - Set VEXA_API_URL and VEXA_API_KEY in your environment

2. Implement VexaAdapter in src/lib/adapters/meetingbot.ts (add alongside MeetingBaaSAdapter):
   Implement the same MeetingBotAdapter interface.
   - joinMeeting: POST to your Vexa instance /api/v1/bots/join
   - leaveMeeting: POST /api/v1/bots/:botId/leave
   - raiseHand: Vexa v1 does not support raise hand natively — implement as sendChatMessage("✋ I have something relevant to share") as a graceful fallback
   - speakText: POST audio buffer to Vexa's TTS injection endpoint
   - Map Vexa's webhook event format to the internal TranscriptChunk format (field names differ from MeetingBaaS)

3. Update getMeetingBotAdapter() factory:
   - Check MEETING_BOT_PROVIDER env var: 'meetingbaas' | 'vexa'
   - No code changes needed anywhere else — the adapter pattern handles it

4. Document the webhook event format differences between MeetingBaaS and Vexa in src/lib/adapters/meetingbot.ts as inline comments, so future developers understand both.

5. Update README.md with a "Self-hosting with Vexa" section.

6. Migration plan for existing teams:
   - Keep MeetingBaaS running for existing bot sessions
   - New meetings: use Vexa
   - Feature flag: MEETING_BOT_PROVIDER=vexa in env to switch

Output: VexaAdapter implementation, updated factory, deployment docs, README section.
```

---

## 9. Summary of what each prompt builds

| Prompt | What it produces |
|---|---|
| 01 | Project scaffold, folder structure (incl. pipecat-sidecar/), dependencies, env vars |
| 02 | Full database schema + pgvector migration + Supabase query helpers |
| 03 | TS adapter interfaces (meetingbot, pipecat, llm) + full Pipecat Python sidecar (app.py, bot.py, Dockerfile) |
| 04 | All Claude prompt templates (classify, compose, extract, standup) |
| 05 | Memory agent (search, ingest, decision history) |
| 06 | Meeting agent (session, rolling window, classification loop) |
| 07 | Supervisor agent (orchestration, guardrails, Pipecat triggerSpeak) |
| 08 | Integration agent (Jira, Slack, Calendar, Notion) |
| 09 | MeetingBaaS webhook handler (spawns Pipecat on join) + meeting creation API |
| 10 | Search API, memory API, Clerk webhook |
| 11 | Dashboard, sidebar, layout, BotStatusBadge with pulse animation |
| 12 | Meeting detail page (transcript, summary, bot intervention cards) |
| 13 | Cross-meeting search UI |
| 14 | Onboarding wizard (4-step, <10 min to first bot join) |
| 15 | Settings pages (integrations, team config, bot behaviour) |
| 16 | Post-meeting processing job (summary, decisions, memory ingestion) |
| 17 | End-to-end tests for core agent flow |
| 18 | Deployment config, CI/CD, error classes, logger, README (covers both Next.js and Pipecat sidecar) |
| 19 | Beta user materials (setup guide, feedback template, metrics) |
| 20 | v1.1 migration to Vexa (eliminate MeetingBaaS dependency) |


*End of Insider Build Plan — v1.1 (updated: Pipecat sidecar architecture, ElevenLabs/Google TTS as providers, chat-message-based signalling)*
