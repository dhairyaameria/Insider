/**
 * Hand-written database types mirroring supabase/migrations/001_initial.sql.
 * Replace with `supabase gen types typescript` output once the project is linked.
 *
 * Note on vector columns: PostgREST returns pgvector values as strings
 * (e.g. "[0.1,0.2,...]") and accepts number[] on insert.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MeetingPlatform = "zoom" | "meet" | "teams";
export type MeetingStatus = "scheduled" | "active" | "completed";
export type RitualType = "standup" | "planning" | "incident_review" | "general";
export type MemorySourceType = "meeting" | "ticket" | "pr" | "doc";
export type MemoryStatus = "open" | "resolved" | "deprecated";
export type IntegrationProvider = "jira" | "linear" | "github" | "slack" | "notion";

/** Shape of entries in meeting_summaries.decisions */
export interface Decision {
  decision: string;
  owner: string | null;
  timestamp: string | null;
}

/** Shape of entries in meeting_summaries.action_items */
export interface ActionItem {
  task: string;
  assignee: string | null;
  due_date: string | null;
}

/** Shape of entries in bot_sessions.issues_surfaced */
export interface SurfacedIssue {
  issue_id: string;
  surfaced_at: string;
  problem_summary?: string | null;
  title?: string | null;
  similarity?: number | null;
  resolved_at?: string | null;
  links?: string[];
  spoken_text?: string | null;
}

export interface Database {
  public: {
    Tables: {
      orgs: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          org_id: string | null;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          org_id: string | null;
          clerk_user_id: string;
          email: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          clerk_user_id: string;
          email: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          clerk_user_id?: string;
          email?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          role: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          role?: string;
        };
        Update: {
          team_id?: string;
          user_id?: string;
          role?: string;
        };
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          org_id: string | null;
          team_id: string | null;
          platform: string;
          external_meeting_id: string | null;
          meeting_url: string | null;
          title: string | null;
          started_at: string | null;
          ended_at: string | null;
          status: string;
          ritual_type: string;
          bot_joined: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          team_id?: string | null;
          platform: string;
          external_meeting_id?: string | null;
          meeting_url?: string | null;
          title?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          status?: string;
          ritual_type?: string;
          bot_joined?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          team_id?: string | null;
          platform?: string;
          external_meeting_id?: string | null;
          meeting_url?: string | null;
          title?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          status?: string;
          ritual_type?: string;
          bot_joined?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      meeting_chunks: {
        Row: {
          id: string;
          meeting_id: string | null;
          org_id: string;
          team_id: string | null;
          speaker_label: string | null;
          text: string;
          started_at: string | null;
          ended_at: string | null;
          embedding: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id?: string | null;
          org_id: string;
          team_id?: string | null;
          speaker_label?: string | null;
          text: string;
          started_at?: string | null;
          ended_at?: string | null;
          embedding?: number[] | string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string | null;
          org_id?: string;
          team_id?: string | null;
          speaker_label?: string | null;
          text?: string;
          started_at?: string | null;
          ended_at?: string | null;
          embedding?: number[] | string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      meeting_summaries: {
        Row: {
          id: string;
          meeting_id: string | null;
          summary_text: string | null;
          decisions: Json;
          action_items: Json;
          risks: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id?: string | null;
          summary_text?: string | null;
          decisions?: Json;
          action_items?: Json;
          risks?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string | null;
          summary_text?: string | null;
          decisions?: Json;
          action_items?: Json;
          risks?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      memory_items: {
        Row: {
          id: string;
          org_id: string;
          team_id: string | null;
          source_type: string;
          source_id: string | null;
          title: string;
          body: string;
          status: string;
          resolved_at: string | null;
          tags: string[];
          embedding: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          team_id?: string | null;
          source_type: string;
          source_id?: string | null;
          title: string;
          body: string;
          status?: string;
          resolved_at?: string | null;
          tags?: string[];
          embedding?: number[] | string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          team_id?: string | null;
          source_type?: string;
          source_id?: string | null;
          title?: string;
          body?: string;
          status?: string;
          resolved_at?: string | null;
          tags?: string[];
          embedding?: number[] | string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      bot_sessions: {
        Row: {
          id: string;
          meeting_id: string | null;
          issues_surfaced: Json;
          hand_raised_at: string | null;
          last_spoke_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meeting_id?: string | null;
          issues_surfaced?: Json;
          hand_raised_at?: string | null;
          last_spoke_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string | null;
          issues_surfaced?: Json;
          hand_raised_at?: string | null;
          last_spoke_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          id: string;
          org_id: string | null;
          provider: string;
          credentials_encrypted: string | null;
          config: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          provider: string;
          credentials_encrypted?: string | null;
          config?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          provider?: string;
          credentials_encrypted?: string | null;
          config?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_memory_items: {
        Args: {
          query_embedding: number[] | string;
          filter_org_id: string;
          filter_team_id?: string | null;
          filter_status?: string | null;
          match_count?: number;
        };
        Returns: {
          id: string;
          org_id: string;
          team_id: string | null;
          source_type: string;
          source_id: string | null;
          title: string;
          body: string;
          status: string;
          resolved_at: string | null;
          tags: string[];
          metadata: Json;
          created_at: string;
          similarity: number;
        }[];
      };
      match_meeting_chunks: {
        Args: {
          query_embedding: number[] | string;
          filter_org_id: string;
          filter_meeting_id?: string | null;
          filter_team_id?: string | null;
          match_count?: number;
        };
        Returns: {
          id: string;
          meeting_id: string | null;
          org_id: string;
          team_id: string | null;
          speaker_label: string | null;
          text: string;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases
export type Org = Database["public"]["Tables"]["orgs"]["Row"];
export type Team = Database["public"]["Tables"]["teams"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type MeetingChunk = Database["public"]["Tables"]["meeting_chunks"]["Row"];
export type MeetingSummary = Database["public"]["Tables"]["meeting_summaries"]["Row"];
export type MemoryItem = Database["public"]["Tables"]["memory_items"]["Row"];
export type BotSession = Database["public"]["Tables"]["bot_sessions"]["Row"];
export type Integration = Database["public"]["Tables"]["integrations"]["Row"];

// Insert / update aliases
export type MeetingInsert = Database["public"]["Tables"]["meetings"]["Insert"];
export type MeetingUpdate = Database["public"]["Tables"]["meetings"]["Update"];
export type MeetingChunkInsert = Database["public"]["Tables"]["meeting_chunks"]["Insert"];
export type MeetingSummaryInsert = Database["public"]["Tables"]["meeting_summaries"]["Insert"];
export type MemoryItemInsert = Database["public"]["Tables"]["memory_items"]["Insert"];
export type BotSessionInsert = Database["public"]["Tables"]["bot_sessions"]["Insert"];
export type BotSessionUpdate = Database["public"]["Tables"]["bot_sessions"]["Update"];

// RPC result aliases
export type MemoryItemMatch =
  Database["public"]["Functions"]["match_memory_items"]["Returns"][number];
export type MeetingChunkMatch =
  Database["public"]["Functions"]["match_meeting_chunks"]["Returns"][number];
