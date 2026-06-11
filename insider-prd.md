# Insider — Complete Build Plan

## 0. What you are building

**Insider** is a SaaS platform where AI bots join Zoom, Google Meet, and Microsoft Teams meetings, build a shared semantic memory from every meeting and connected project tool, and speak up when a current discussion matches a previously resolved issue.

**Core loop:** Bot joins meeting → transcribes in real time → detects blockers/incidents → searches vector memory for similar resolved issues → raises hand → speaks a 1–2 sentence suggestion with links → logs everything back to memory.

**Primary users (v1):** Engineering teams — devs, PMs, EMs — in standups, sprint planning, and incident reviews.

**One-line pitch:** The AI PM that remembers everything your team already solved.

---

## 1. Confirmed tech stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS + shadcn/ui | Full-stack in one repo, Vercel free tier |
| Backend API | Next.js API Routes (same repo) | Simplicity for v1; migrate to Hono if needed |
| Auth | Clerk | Free up to 10k MAU, org/team support built in |
| Database | Supabase (Postgres) | Free tier, built-in pgvector, real-time |
| Vector store | pgvector on Supabase | No extra vendor; handles 50M+ vectors |
| Meeting bot (join/record) | MeetingBaaS (v1) → Vexa self-hosted (v1.1+) | MeetingBaaS for speed; Vexa for zero lock-in |
| Audio pipeline (speaking) | Pipecat (open-source Python, self-hosted) | Orchestrates VAD → STT → LLM → TTS in-meeting; handles interrupt detection and audio injection |
| STT (inside Pipecat) | Groq-hosted Whisper (primary, free tier) | <300ms, free, no GPU ops |
| TTS (inside Pipecat) | ElevenLabs (primary) | Voice quality matters for demos |
| TTS fallback (inside Pipecat) | Google Cloud TTS | Already in Google API surface, cheap at scale |
| LLM | Claude API (claude-sonnet-4-20250514) | Summaries, decisions, problem classification |
| Embeddings | OpenAI text-embedding-3-small | Cost-effective, 1536-dim |
| Queue | Upstash Redis | Free tier, 10k commands/day |
| Language | TypeScript (Next.js) + Python (Pipecat sidecar) | TS for all product logic; Python required for Pipecat |
| Hosting | Vercel (frontend + API) + $10–20/mo VPS (Pipecat) | Vercel free tier; small VPS for the Python sidecar |
| Monitoring | Axiom + OpenTelemetry | Free tier |
| CI/CD | GitHub Actions | Free for public/small private repos |

**Important — Pipecat is a pipeline framework, not a TTS provider.** It orchestrates the real-time audio loop inside the meeting: it receives raw audio from MeetingBaaS over a WebSocket, runs Voice Activity Detection to know when to speak, calls Groq Whisper for STT, calls Claude for reasoning, and calls ElevenLabs (or Google TTS as fallback) for voice synthesis. ElevenLabs and Google TTS are still the voice providers — Pipecat is the thing that calls them at the right moment with the right context and injects the resulting audio back into the meeting.

```
Meeting audio in (MeetingBaaS WebSocket)
        │
        ▼
   [Pipecat pipeline — Python sidecar]
        ├── VAD: detects speaking pauses (Silero / WebRTC VAD)
        ├── STT: Groq Whisper  ← provider
        ├── LLM: Claude API    ← provider
        └── TTS: ElevenLabs    ← provider (Google TTS fallback)
        │
        ▼
Meeting audio out (injected back via MeetingBaaS WebSocket)
```

**Approximate cost at zero users:** ~$110–140/month (MeetingBaaS ~$99, Claude API ~$5–20 at low volume, $10–20 VPS for Pipecat sidecar, everything else free tier).

**No vendor lock-in principle:** Every layer is swappable via abstraction. Meeting bot, STT, TTS, and LLM are all behind adapter interfaces. No business logic touches vendor SDKs directly. Pipecat itself is open-source and self-hosted — swapping the TTS provider is a one-line config change.

---

## 2. Multi-agent architecture

Insider uses four agents. They communicate through a shared message bus (Upstash Redis pub/sub) and read/write to shared memory (pgvector).

### Agent map

```
                    ┌─────────────────────┐
                    │   Supervisor agent   │
                    │ Orchestrates, routes │
                    │ guards, enforces     │
                    └──────┬──────┬───────┘
                           │      │
           ┌───────────────┘      └───────────────┐
           ▼                                       ▼
  ┌────────────────┐   ◄──►   ┌────────────────┐  ◄──►  ┌──────────────────┐
  │ Meeting agent  │          │  Memory agent  │         │Integration agent │
  │ Listens,       │          │ Ingests, embeds│         │ Jira, Linear,    │
  │ detects probs  │          │ retrieves from │         │ Slack, GitHub,   │
  │ raises hand,   │          │ pgvector       │         │ Notion, Calendar │
  │ speaks via TTS │          └────────┬───────┘         └──────────────────┘
  └────────────────┘                   │
           │                           │
           └───────────┬───────────────┘
                       ▼
              ┌─────────────────┐
              │  Shared memory  │
              │ Supabase Postgres│
              │   + pgvector    │
              └─────────────────┘
```

### Agent responsibilities

**Supervisor agent**
- Receives all inter-agent messages
- Routes tasks to the correct agent
- Enforces guardrails: don't raise hand twice for the same issue in one meeting, don't interrupt mid-sentence, graceful fallback if memory is down
- Owns the meeting session state (who's talking, what ritual is active)
- In v1: implemented as a stateless Claude prompt with context injection. Grows into a proper supervisor with tool calls in v2.

**Meeting agent** (in-meeting brain)
- Owns the rolling 90-second transcript window
- Runs a Claude classification prompt every ~15 seconds: "Does this window contain a blocker, incident, or repeated problem?"
- When it detects one, synthesises a `problem_summary` string and sends it to the Memory agent via Supervisor
- Owns ritual templates: standup, sprint planning, incident review
- Knows which template to use based on meeting title/calendar metadata
- When called on by host: composes a 1–2 sentence spoken response using the Memory agent's result, sends to TTS

**Memory agent**
- `find_similar_resolved_issues(problem_summary)` — cosine similarity query on pgvector, filtered by `status=resolved` and recency
- `get_decision_history(project, topic)` — semantic search scoped to decisions
- `search_meetings(query)` — general semantic search across all meeting chunks
- `ingest_meeting(transcript, metadata)` — post-meeting: chunk, embed, store
- `ingest_ticket(ticket)` — Jira/Linear ticket ingestion
- Stateless: no session state, pure read/write to pgvector

**Integration agent**
- All external writes go through this agent only. No other agent touches external APIs directly.
- `create_ticket(platform, data)` — Jira or Linear
- `post_to_slack(channel, message, blocks)` — formatted Slack message
- `sync_to_notion(page_id, content)` — post-meeting summary
- `fetch_calendar_events(user_id, date_range)` — Google Calendar / MS Graph
- `fetch_tickets(project_id, filters)` — pull Jira/Linear context into memory

### In-meeting flow

There are two parallel processes once a meeting starts: the **Pipecat sidecar** handles real-time audio in/out, and the **Next.js Meeting agent** handles classification and memory lookup. They communicate via webhook and Redis.

```
┌─────────────────────────────────────────────────────────────┐
│  PIPECAT SIDECAR (Python, self-hosted)                       │
│                                                             │
│  MeetingBaaS WebSocket (raw audio in)                       │
│          │                                                  │
│          ▼                                                  │
│  VAD — detects speech end / natural pause                   │
│          │                                                  │
│          ▼                                                  │
│  STT — Groq Whisper (<300ms chunks)                         │
│          │                                                  │
│          ├──── POST transcript chunk ──► Next.js webhook    │
│          │                                                  │
│          ▼  (when told to speak)                            │
│  TTS — ElevenLabs (Google TTS fallback)                     │
│          │                                                  │
│          ▼                                                  │
│  Audio injected back via MeetingBaaS WebSocket              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NEXT.JS APP (TypeScript)                                    │
│                                                             │
│  Receives transcript chunks via webhook                     │
│          │                                                  │
│          ▼                                                  │
│  Rolling 90s transcript window (Meeting agent)              │
│          │                                                  │
│          ▼                                                  │
│  Claude classification: blocker/incident?                   │
│          │ yes                   │ no                       │
│          ▼                       ▼                          │
│  Memory agent:           continue listening                 │
│  find_similar_resolved_issues()                             │
│          │                                                  │
│          ├── no match ──► log + continue                    │
│          │                                                  │
│          └── match found                                    │
│                │                                            │
│                ▼                                            │
│  Supervisor: should we speak?                               │
│  (checks: already raised? spoke recently? threshold met?)   │
│                │ yes                                        │
│                ▼                                            │
│  1. POST chat message to meeting:                           │
│     "✋ Insider has a relevant note —                    │
│      finishing this thought first"                          │
│  2. Signal Pipecat to speak at next VAD pause               │
│  3. Compose response (Claude, 1–2 sentences + links)        │
│  4. Send text to Pipecat → ElevenLabs TTS → audio out       │
│  5. Integration agent: post links to chat                   │
└─────────────────────────────────────────────────────────────┘
```

**Why the chat message instead of a platform hand-raise:** Zoom, Google Meet, and Teams do not expose public APIs for programmatic hand-raise. The chat message serves the same social function — it signals the bot has something to contribute — and the VAD-based speak trigger means the bot waits for a natural pause rather than interrupting. This is actually a better UX than a hand-raise because it's fully automatic.

---

## 3. Database schema (Postgres + pgvector)

```sql
-- Orgs and teams
orgs (id, name, slug, created_at)
teams (id, org_id, name, created_at)
users (id, org_id, clerk_user_id, email, role, created_at)
team_members (team_id, user_id, role)

-- Meetings
meetings (
  id, org_id, team_id,
  platform,           -- zoom | meet | teams
  external_meeting_id,
  title, started_at, ended_at,
  status,             -- scheduled | active | completed
  ritual_type,        -- standup | planning | incident_review | general
  bot_joined,
  created_at
)

meeting_chunks (
  id, meeting_id, org_id, team_id,
  speaker_label,
  text,
  started_at, ended_at,
  embedding vector(1536),  -- pgvector
  created_at
)

meeting_summaries (
  id, meeting_id,
  summary_text,
  decisions jsonb,     -- [{decision, owner, timestamp}]
  action_items jsonb,  -- [{task, assignee, due_date}]
  risks jsonb,
  created_at
)

-- Memory / knowledge items
memory_items (
  id, org_id, team_id,
  source_type,        -- meeting | ticket | pr | doc
  source_id,
  title,
  body,
  status,             -- open | resolved | deprecated
  resolved_at,
  tags text[],
  embedding vector(1536),
  metadata jsonb,
  created_at
)

-- Bot session state (ephemeral, Redis-backed, but mirrored here for audit)
bot_sessions (
  id, meeting_id,
  issues_surfaced jsonb,   -- [{issue_id, surfaced_at}]
  hand_raised_at,
  last_spoke_at,
  created_at, updated_at
)

-- Integrations
integrations (
  id, org_id,
  provider,           -- jira | linear | github | slack | notion
  credentials_encrypted text,
  config jsonb,
  created_at
)
```

---

## 4. API surface (Next.js API routes)

```
POST   /api/auth/webhook              Clerk webhook — user/org created
GET    /api/orgs/:id                  Org details
POST   /api/meetings                  Schedule bot for a meeting
GET    /api/meetings/:id              Meeting details + summary
GET    /api/meetings/:id/transcript   Full transcript with speakers
POST   /api/meetings/:id/search       Semantic search within meeting
POST   /api/memory/search             Cross-meeting semantic search
GET    /api/memory/decisions          Decision history
POST   /api/bot/webhook               MeetingBaaS webhook — transcript chunks, events
POST   /api/integrations/:provider    Connect an integration (OAuth callback)
DELETE /api/integrations/:provider    Disconnect
GET    /api/teams/:id/settings        Team config (thresholds, auto-join rules)
PUT    /api/teams/:id/settings        Update config
```

---

## 5. Frontend pages

```
/                          Marketing landing page
/login                     Clerk sign-in
/onboarding                Org setup wizard (connect calendar + first integration)
/dashboard                 Weekly summary: meetings, issues surfaced, decisions
/meetings                  Meeting list with status
/meetings/[id]             Meeting detail: transcript, summary, decisions, action items
/search                    Cross-meeting semantic search UI
/settings/integrations     Connect Zoom, Meet, Teams, Jira, Linear, Slack, Notion
/settings/team             Bot behaviour config (auto-join rules, thresholds)
/settings/billing          (stub for v1)
```

---

## 6. Design system

### Visual identity

Insider serves engineering teams. The aesthetic should feel like a high-quality internal tool — precise, information-dense, trustworthy. Not a bubbly consumer app. Think Linear meets Vercel dashboard.

**Palette**
```
--brand-900: #0F0F0F    /* near-black — primary text, headers */
--brand-800: #1A1A2E    /* deep navy — nav bg, sidebar */
--brand-700: #16213E    /* navy — card bg in dark mode */
--brand-accent: #6C63FF /* violet — primary CTA, active states, bot indicator */
--brand-teal: #00B4D8   /* teal — memory/knowledge highlights */
--brand-success: #22C55E
--brand-warning: #F59E0B
--brand-danger: #EF4444
--surface: #F8F8FC      /* off-white — page background light mode */
--surface-card: #FFFFFF
--text-primary: #111827
--text-secondary: #6B7280
--text-muted: #9CA3AF
--border: #E5E7EB
```

**Typography**
- Display/headings: `Inter` (700) — precise, engineering-grade
- Body: `Inter` (400/500) — consistent with headings, clean at small sizes
- Code/transcripts: `JetBrains Mono` — transcripts and ticket refs feel at home
- Scale: 12 / 14 / 16 / 20 / 24 / 32 / 48px

**Signature element:** The bot's "listening" state — a subtle animated violet pulse ring around the bot avatar in the meeting view. When the bot raises its hand, it shifts to a solid violet with a brief expand animation. This is the one moment of delight.

**Component library:** shadcn/ui with the above token overrides. Do not use the default shadcn slate theme — override with the brand palette above.

**Layout:** Sidebar nav (240px fixed) + main content area. No top nav. Sidebar collapses on mobile.

---

## 7. Non-functional requirements summary

- STT latency: <300ms per chunk (Groq Whisper)
- Semantic search: <500ms p95
- Bot join success rate: >99% for scheduled meetings
- Bot speak response: <2–3 seconds from being called on
- Data encrypted at rest (Supabase) and in transit (TLS)
- Team-scoped memory: Team A cannot query Team B's data (row-level security in Postgres)
- Graceful degradation: if memory service fails, bot continues transcribing but does not raise hand
- Raise hand: exactly once per unique issue per meeting session

---

## 8. Guardrails and things not to break

These are explicit constraints. Any AI working on this codebase must not violate them.

1. **No agent calls an external API directly except IntegrationAgent.** Meeting agent → Supervisor → Integration agent. This is the pattern. Do not shortcut it.

2. **TTS is Pipecat's job, not Next.js's job.** The Next.js agents compose the response text and call `getPipecatAdapter().triggerSpeak()`. They never call ElevenLabs or Google TTS directly. The Pipecat sidecar owns all audio synthesis and injection.

3. **Pipecat is a dumb audio pipe.** The bot.py in the Pipecat sidecar does not run Claude, does not query memory, and does not make decisions. It transcribes audio, forwards chunks to Next.js, and plays audio when told to. All intelligence lives in the Next.js agents.

4. **Row-level security is non-negotiable.** Team A cannot see Team B's data. Every Supabase query that touches meeting_chunks, memory_items, or meeting_summaries must include an org_id filter. The RLS policies are a safety net, not the primary enforcement.

5. **The bot signals intent via chat message, not platform hand-raise.** Zoom, Google Meet, and Teams do not expose public APIs for programmatic hand-raise. `sendChatMessage("✋ Insider has a relevant note...")` is the correct and only mechanism. Do not attempt to automate the hand-raise UI.

6. **The bot speaks exactly once per unique issue per meeting.** The Supervisor's shouldRaiseHand() guardrail is the enforcer. Do not bypass it.

7. **The webhook handler always returns 200.** If it returns 5xx, MeetingBaaS retries, causing duplicate events and duplicate speech. Every error must be caught internally.

8. **All vendor calls have timeouts.** 10 seconds maximum on the TypeScript side; 8 seconds on the Python side (to leave headroom). If ElevenLabs, Groq, MeetingBaaS, or Anthropic does not respond in time, fail gracefully — the meeting continues, the bot stays silent for that turn.

9. **Stale resolutions are filtered.** The memory agent filters out matches where resolved_at is older than 180 days. Do not surface a fix from 2 years ago as authoritative.

10. **Post-meeting ingestion is always non-blocking.** The meeting end event handler must return quickly. Ingestion runs in the background. Do not await long-running ingestion in the webhook handler.

---