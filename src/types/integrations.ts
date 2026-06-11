export type TicketPlatform = "jira" | "linear";

/** A labelled link, e.g. for chat follow-ups. */
export interface LinkRef {
  label: string;
  url: string;
}

/** A created/synced external ticket reference. */
export interface TicketRef {
  ticketId: string;
  url: string;
}

/** A meeting pulled from a connected calendar. */
export interface CalendarMeeting {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  meetingUrl: string | null;
  attendees: string[];
}

/** An external ticket normalised for memory ingestion. */
export interface ExternalTicket {
  id: string;
  title: string;
  description: string;
  status: string;
  resolvedAt?: Date;
  url: string;
}

// Credential payloads stored (JSON) in integrations.credentials_encrypted.
// TODO(security): encrypt at rest — v1 stores serialized JSON.

export interface SlackCredentials {
  webhook_url: string;
}

export interface JiraCredentials {
  base_url: string;
  email: string;
  api_token: string;
}

export interface LinearCredentials {
  api_key: string;
}

export interface GoogleCalendarCredentials {
  access_token: string;
}
