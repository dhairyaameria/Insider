import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./server";
import type {
  BotSession,
  BotSessionUpdate,
  Database,
  Integration,
  Meeting,
  MeetingChunk,
  MeetingChunkInsert,
  MeetingChunkMatch,
  MeetingSummary,
  MeetingSummaryInsert,
  MeetingInsert,
  MeetingUpdate,
  MemoryItem,
  MemoryItemInsert,
  MemoryItemMatch,
  Org,
  Team,
  User,
} from "./types";

type DbClient = SupabaseClient<Database>;

let adminClient: DbClient | null = null;

function db(): DbClient {
  if (!adminClient) {
    adminClient = createSupabaseAdminClient();
  }
  return adminClient;
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Looks up the internal meeting record by the external bot id. */
export async function getMeetingByExternalId(
  externalId: string,
): Promise<Meeting | null> {
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .eq("external_meeting_id", externalId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createMeeting(meeting: MeetingInsert): Promise<Meeting> {
  const { data, error } = await db()
    .from("meetings")
    .insert(meeting)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateMeeting(
  id: string,
  update: MeetingUpdate,
): Promise<Meeting> {
  const { data, error } = await db()
    .from("meetings")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserByClerkId(
  clerkUserId: string,
): Promise<User | null> {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getMeetingSummary(
  meetingId: string,
): Promise<MeetingSummary | null> {
  const { data, error } = await db()
    .from("meeting_summaries")
    .select("*")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getBotSession(
  meetingId: string,
): Promise<BotSession | null> {
  const { data, error } = await db()
    .from("bot_sessions")
    .select("*")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ── Clerk webhook mirroring ──────────────────────────────────────────────

/** Idempotent on clerk_user_id so Clerk webhook retries are safe. */
export async function upsertUserByClerkId(user: {
  clerk_user_id: string;
  email: string;
  org_id?: string | null;
  role?: string;
}): Promise<User> {
  const { data, error } = await db()
    .from("users")
    .upsert(user, { onConflict: "clerk_user_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Idempotent on slug (unique) so Clerk webhook retries are safe. */
export async function upsertOrgBySlug(name: string, slug: string): Promise<Org> {
  const { data, error } = await db()
    .from("orgs")
    .upsert({ name, slug }, { onConflict: "slug" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const { data, error } = await db()
    .from("orgs")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createTeam(orgId: string, name: string): Promise<Team> {
  const { data, error } = await db()
    .from("teams")
    .insert({ org_id: orgId, name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** The org's oldest team is the default. */
export async function getDefaultTeam(orgId: string): Promise<Team | null> {
  const { data, error } = await db()
    .from("teams")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function setUserOrg(
  clerkUserId: string,
  orgId: string,
): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ org_id: orgId })
    .eq("clerk_user_id", clerkUserId);

  if (error) throw error;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role = "member",
): Promise<void> {
  const { error } = await db()
    .from("team_members")
    .upsert(
      { team_id: teamId, user_id: userId, role },
      { onConflict: "team_id,user_id" },
    );

  if (error) throw error;
}

export async function getMeetingsByOrg(
  orgId: string,
  limit = 10,
): Promise<Meeting[]> {
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getMeetingsSince(
  orgId: string,
  sinceIso: string,
): Promise<Meeting[]> {
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .eq("org_id", orgId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function countDecisionsSince(
  orgId: string,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await db()
    .from("memory_items")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .contains("tags", ["decision"])
    .gte("created_at", sinceIso);

  if (error) throw error;
  return count ?? 0;
}

export async function getRecentDecisions(
  orgId: string,
  limit = 5,
): Promise<MemoryItem[]> {
  const { data, error } = await db()
    .from("memory_items")
    .select("*")
    .eq("org_id", orgId)
    .contains("tags", ["decision"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getBotSessionsForMeetings(
  meetingIds: string[],
): Promise<BotSession[]> {
  if (meetingIds.length === 0) return [];
  const { data, error } = await db()
    .from("bot_sessions")
    .select("*")
    .in("meeting_id", meetingIds);

  if (error) throw error;
  return data ?? [];
}

export async function getTeamsByOrg(orgId: string): Promise<Team[]> {
  const { data, error } = await db()
    .from("teams")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getMeetingsByTeam(
  teamId: string,
  limit = 20,
): Promise<Meeting[]> {
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .eq("team_id", teamId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getMeetingChunks(
  meetingId: string,
): Promise<MeetingChunk[]> {
  const { data, error } = await db()
    .from("meeting_chunks")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("started_at", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Cosine-similarity search over memory_items via the match_memory_items
 * SQL function. orgId is mandatory — team-scoped memory is non-negotiable.
 */
export async function searchMemoryItems(
  embedding: number[],
  orgId: string,
  teamId?: string,
  limit = 10,
  status?: string,
): Promise<MemoryItemMatch[]> {
  const { data, error } = await db().rpc("match_memory_items", {
    query_embedding: embedding,
    filter_org_id: orgId,
    filter_team_id: teamId ?? null,
    filter_status: status ?? null,
    match_count: limit,
  });

  if (error) throw error;
  return data ?? [];
}

/**
 * Cosine-similarity search over meeting_chunks via the match_meeting_chunks
 * SQL function. orgId is mandatory.
 */
export async function searchMeetingChunksByEmbedding(
  embedding: number[],
  orgId: string,
  opts: { meetingId?: string; teamId?: string; limit?: number } = {},
): Promise<MeetingChunkMatch[]> {
  const { data, error } = await db().rpc("match_meeting_chunks", {
    query_embedding: embedding,
    filter_org_id: orgId,
    filter_meeting_id: opts.meetingId ?? null,
    filter_team_id: opts.teamId ?? null,
    match_count: opts.limit ?? 10,
  });

  if (error) throw error;
  return data ?? [];
}

export async function getIntegration(
  orgId: string,
  provider: string,
): Promise<Integration | null> {
  const { data, error } = await db()
    .from("integrations")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getMeetingsByIds(ids: string[]): Promise<Meeting[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("meetings")
    .select("*")
    .in("id", ids);

  if (error) throw error;
  return data ?? [];
}

/**
 * Upsert keyed on (org_id, source_type, source_id) — the schema has no
 * unique constraint on source_id, so dedupe is select-then-write.
 */
export async function upsertMemoryItemBySource(
  item: MemoryItemInsert & { source_id: string },
): Promise<MemoryItem> {
  const { data: existing, error: selectError } = await db()
    .from("memory_items")
    .select("id")
    .eq("org_id", item.org_id)
    .eq("source_type", item.source_type)
    .eq("source_id", item.source_id)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    const { data, error } = await db()
      .from("memory_items")
      .update(item)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  return saveMemoryItem(item);
}

/**
 * Upserts the bot session for a meeting (unique on meeting_id) and bumps
 * updated_at. Redis is the live store; this row is the audit mirror.
 */
export async function upsertBotSession(
  meetingId: string,
  update: Omit<BotSessionUpdate, "id" | "meeting_id" | "created_at">,
): Promise<BotSession> {
  const { data, error } = await db()
    .from("bot_sessions")
    .upsert(
      {
        meeting_id: meetingId,
        ...update,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveMeetingChunk(
  chunk: MeetingChunkInsert,
): Promise<MeetingChunk> {
  const { data, error } = await db()
    .from("meeting_chunks")
    .insert(chunk)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveMeetingSummary(
  summary: MeetingSummaryInsert,
): Promise<MeetingSummary> {
  const { data, error } = await db()
    .from("meeting_summaries")
    .upsert(summary, { onConflict: "meeting_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveMemoryItem(
  item: MemoryItemInsert,
): Promise<MemoryItem> {
  const { data, error } = await db()
    .from("memory_items")
    .insert(item)
    .select()
    .single();

  if (error) throw error;
  return data;
}
