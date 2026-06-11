import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureOrgUser } from "./provision";
import type { User } from "./supabase/types";

/** Consistent error shape across all API routes: { error, code }. */
export function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export type OrgUserResult =
  | { ok: true; user: User; orgId: string }
  | { ok: false; response: NextResponse };

/** Clerk auth + org resolution for authenticated routes. */
export async function requireOrgUser(): Promise<OrgUserResult> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ok: false,
      response: errorJson("UNAUTHORIZED", "authentication required", 401),
    };
  }

  // Self-provisions the Supabase mirror on first sight (fast path: 1 SELECT).
  const user = await ensureOrgUser();
  if (!user?.org_id) {
    return {
      ok: false,
      response: errorJson("NO_ORG", "user has no organization", 403),
    };
  }

  return { ok: true, user, orgId: user.org_id };
}

/** Structured request log with timing. */
export function logRequest(
  route: string,
  startedAt: number,
  status: number,
  extra: Record<string, unknown> = {},
): void {
  console.info(
    JSON.stringify({
      level: "info",
      type: "request",
      route,
      status,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      ...extra,
    }),
  );
}
