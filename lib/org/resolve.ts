import { createClient } from "@/lib/supabase/server";

export interface ResolvedOrg {
  id: string;
  name: string;
  slug: string;
  membership_status: string | null;
}

/**
 * Resolve an organization slug to its core identifiers.
 *
 * Uses the server Supabase client (cookie-based auth) so RLS is respected.
 * Returns null if the slug does not match any non-archived organization.
 */
export async function resolveOrgSlug(
  slug: string
): Promise<ResolvedOrg | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, membership_status")
    .eq("slug", slug)
    .is("archived_at", null)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name ?? "",
    slug: data.slug ?? slug,
    membership_status: data.membership_status,
  };
}
