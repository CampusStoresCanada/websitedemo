import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * supabase.auth.admin.listUsers() defaults to a 50-user page — an unpaginated
 * call against this project's 751 auth users silently checks only the first
 * page, so real existing users beyond it look "not found." Paginates until a
 * short page confirms the end. Mirrors the same fix already shipped for
 * lookupUserEmails() in lib/comms/audience.ts.
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
