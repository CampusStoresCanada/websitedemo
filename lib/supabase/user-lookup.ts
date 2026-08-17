import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Both lookups below query auth.users directly through a SECURITY DEFINER
 * function rather than walking auth.admin.listUsers() pages.
 *
 * listUsers() cannot be paginated safely on this project. GoTrue pages it with
 * ORDER BY created_at DESC + LIMIT/OFFSET, and 563 of our 767 auth users share
 * one identical created_at (2026-02-05 20:36:24.389964+00, from a bulk import).
 * That sort is ambiguous across the tie, so each page request may order the
 * tied rows differently — pages overlap and some rows land on no page at all.
 * Replaying the 4-page walk returned 767 rows but only 597 distinct users,
 * leaving 170 users permanently invisible. Adding pages cannot fix it; the
 * sort key itself is not unique. See migration 20260817160000.
 */

/**
 * Resolve an account id by email.
 *
 * Returns null only when the account genuinely does not exist. Throws if the
 * lookup could not be completed — callers use this to decide whether to
 * provision a new account, and the old "return null on error" behaviour meant
 * a failed lookup was indistinguishable from "no such user", which is what
 * sent existing members down the create-account path and into a 422.
 */
export async function findUserByEmail(supabase: AdminClient, email: string): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  const { data, error } = await supabase.rpc("get_users_by_emails", { p_emails: [target] });
  if (error) {
    console.error("[findUserByEmail] lookup failed:", error);
    throw new Error(`Could not look up account for ${email}: ${error.message}`);
  }
  const match = (data ?? [])[0];
  return match ? { id: match.id } : null;
}

/**
 * Resolve emails for a known set of user ids — the common "I have
 * profile/membership rows with user ids, I need their emails to notify or
 * display them" case.
 *
 * Unlike findUserByEmail this does not throw: every caller is a display or
 * notification path where one unresolvable id should not take down a page or
 * abort a whole batch of sends. It returns whatever it resolved.
 */
export async function lookupUserEmailsByIds(
  supabase: AdminClient,
  userIds: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return {};

  const { data, error } = await supabase.rpc("lookup_auth_user_emails", { p_user_ids: unique });
  if (error) {
    console.error("[lookupUserEmailsByIds] lookup failed:", error);
    return {};
  }

  const emailMap: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ id: string; email: string }>) {
    if (row.email) emailMap[row.id] = row.email;
  }
  return emailMap;
}

/**
 * Resolve the active org_admin emails for an organization, oldest
 * assignment first (deterministic — user_organizations has no
 * is_primary/primary_admin column). Billing and renewal notices need the
 * org_admin's login email, not organizations.email (a separate,
 * public-facing "Store Contact" address shown on the org page — see
 * components/org/MemberProfile.tsx's "Public email" field).
 */
export async function resolveOrgAdminEmails(
  supabase: AdminClient,
  orgId: string
): Promise<string[]> {
  const { data: admins } = await supabase
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "org_admin")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (!admins?.length) return [];

  const emailMap = await lookupUserEmailsByIds(
    supabase,
    admins.map((a) => a.user_id)
  );
  return admins.map((a) => emailMap[a.user_id]).filter((email): email is string => Boolean(email));
}

/**
 * Last-resort billing/renewal email for an org with no active org_admin
 * account and no organizations.email: fall back to a real person already
 * on file in `contacts` (the CRM-style roster synced from Circle/Notion —
 * a "person exists" doesn't imply they ever created a login). Prefers the
 * contact flagged is_primary, then the oldest non-archived contact.
 */
export async function resolveOrgPrimaryContactEmail(
  supabase: AdminClient,
  orgId: string
): Promise<string | null> {
  const { data: contacts } = await supabase
    .from("contacts")
    .select("email, work_email, is_primary, created_at")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("is_primary", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (!contacts?.length) return null;

  for (const c of contacts) {
    const email = c.work_email ?? c.email;
    if (email) return email;
  }
  return null;
}
