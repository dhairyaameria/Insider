import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import {
  addTeamMember,
  createTeam,
  getDefaultTeam,
  getUserByClerkId,
  upsertOrgBySlug,
  upsertUserByClerkId,
} from "./supabase/queries";
import type { User } from "./supabase/types";
import { logVendorError } from "./utils/errors";

/**
 * Resolves the Supabase user for the current Clerk session, provisioning the
 * user/org/team mirror on first sight.
 *
 * The Clerk webhook (/api/auth/webhook) does the same mirroring in
 * production, but it can't reach localhost in dev and may lag in prod —
 * this is the idempotent self-healing path. Fast path is a single SELECT.
 */
export async function ensureOrgUser(): Promise<User | null> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return null;

  try {
    const existing = await getUserByClerkId(userId);
    if (existing?.org_id) return existing;

    const clerkUser = await currentUser();
    if (!clerkUser) return existing;

    const email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";

    // Active Clerk org if there is one, otherwise a personal workspace.
    let name: string;
    let slug: string;
    if (orgId && orgSlug) {
      slug = orgSlug;
      name = orgSlug;
      try {
        const client = await clerkClient();
        const org = await client.organizations.getOrganization({
          organizationId: orgId,
        });
        name = org.name;
      } catch (error) {
        logVendorError("provision", error, { stage: "fetch-org-name", orgId });
      }
    } else {
      slug = `personal-${userId.replace(/^user_/, "").toLowerCase()}`;
      name = clerkUser.firstName
        ? `${clerkUser.firstName}'s workspace`
        : "Personal workspace";
    }

    const org = await upsertOrgBySlug(name, slug);
    const user = await upsertUserByClerkId({
      clerk_user_id: userId,
      email,
      org_id: org.id,
    });

    let team = await getDefaultTeam(org.id);
    if (!team) team = await createTeam(org.id, "General");
    await addTeamMember(team.id, user.id, "member");

    return user;
  } catch (error) {
    logVendorError("provision", error, { clerkUserId: userId });
    return null;
  }
}
