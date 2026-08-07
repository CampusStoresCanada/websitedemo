import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * supabase.auth.admin.listUsers() defaults to a 50-user page — an unpaginated
 * call against this project's 751 auth users silently checks only the first
 * page, so real existing users beyond it look "not found." Paginates until a
 * short page confirms the end.
 */
export async function findUserByEmail(supabase: AdminClient, email: string): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return { id: match.id };
    if (data.users.length < perPage) return null; // last page
  }
}

/**
 * Resolve emails for a known set of user ids — same pagination problem as
 * findUserByEmail, but keyed the other direction (id -> email) for the
 * common "I have profile/membership rows with user ids, I need their
 * emails to notify/display them" case. Stops early once every id has been
 * found rather than always walking the full user table.
 */
export async function lookupUserEmailsByIds(
  supabase: AdminClient,
  userIds: string[]
): Promise<Record<string, string>> {
  const wanted = new Set(userIds);
  const emailMap: Record<string, string> = {};
  const perPage = 200;
  for (let page = 1; wanted.size > Object.keys(emailMap).length; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (wanted.has(u.id) && u.email) emailMap[u.id] = u.email;
    }
    if (data.users.length < perPage) break; // last page
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
