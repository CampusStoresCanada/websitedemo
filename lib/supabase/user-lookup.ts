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
