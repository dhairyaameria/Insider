import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { errorJson, logRequest } from "@/lib/api";
import {
  addTeamMember,
  createTeam,
  getDefaultTeam,
  getOrgBySlug,
  getUserByClerkId,
  setUserOrg,
  upsertOrgBySlug,
  upsertUserByClerkId,
} from "@/lib/supabase/queries";
import { logVendorError } from "@/lib/utils/errors";

/**
 * Clerk webhook (delivered via svix as POST).
 *
 * Mirrors Clerk users/orgs into Supabase:
 * - user.created                  → users row
 * - organization.created          → orgs row + default "General" team
 * - organizationMembership.created → link user to org + team_members row
 *
 * Orgs are correlated by slug (Clerk provides it on both organization and
 * membership events; the orgs table is keyed by unique slug).
 */

export const runtime = "nodejs";

const ROUTE = "POST /api/auth/webhook";

interface ClerkEvent {
  type: string;
  data: {
    id?: string;
    name?: string;
    slug?: string;
    email_addresses?: { id: string; email_address: string }[];
    primary_email_address_id?: string;
    organization?: { id?: string; slug?: string };
    public_user_data?: { user_id?: string };
    role?: string;
  };
}

function verifyClerkWebhook(
  rawBody: string,
  headers: Headers,
): ClerkEvent | null {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    logVendorError("clerk-webhook", "CLERK_WEBHOOK_SECRET not set", {});
    return null;
  }

  try {
    const webhook = new Webhook(secret);
    return webhook.verify(rawBody, {
      "svix-id": headers.get("svix-id") ?? "",
      "svix-timestamp": headers.get("svix-timestamp") ?? "",
      "svix-signature": headers.get("svix-signature") ?? "",
    }) as ClerkEvent;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const rawBody = await req.text();

  const event = verifyClerkWebhook(rawBody, req.headers);
  if (!event) {
    logRequest(ROUTE, startedAt, 400);
    return errorJson("INVALID_SIGNATURE", "webhook verification failed", 400);
  }

  try {
    switch (event.type) {
      case "user.created": {
        const { id, email_addresses, primary_email_address_id } = event.data;
        if (!id) break;

        const email =
          email_addresses?.find((e) => e.id === primary_email_address_id)
            ?.email_address ??
          email_addresses?.[0]?.email_address ??
          "";
        await upsertUserByClerkId({ clerk_user_id: id, email });
        break;
      }

      case "organization.created": {
        const { name, slug } = event.data;
        if (!name || !slug) break;

        const org = await upsertOrgBySlug(name, slug);
        const existingTeam = await getDefaultTeam(org.id);
        if (!existingTeam) {
          await createTeam(org.id, "General");
        }
        break;
      }

      case "organizationMembership.created": {
        const clerkUserId = event.data.public_user_data?.user_id;
        const orgSlug = event.data.organization?.slug;
        if (!clerkUserId || !orgSlug) break;

        const org = await getOrgBySlug(orgSlug);
        if (!org) {
          logVendorError("clerk-webhook", "membership for unknown org", {
            orgSlug,
          });
          break;
        }

        await setUserOrg(clerkUserId, org.id);

        const [user, team] = await Promise.all([
          getUserByClerkId(clerkUserId),
          getDefaultTeam(org.id),
        ]);
        if (user && team) {
          await addTeamMember(team.id, user.id, event.data.role ?? "member");
        }
        break;
      }

      default:
        // Other Clerk events are intentionally ignored.
        break;
    }
  } catch (error) {
    // Processing failures are logged but acknowledged — Clerk retry storms
    // would otherwise re-deliver (handlers above are idempotent regardless).
    logVendorError("clerk-webhook", error, { eventType: event.type });
  }

  logRequest(ROUTE, startedAt, 200, { eventType: event.type });
  return NextResponse.json({ ok: true }, { status: 200 });
}
