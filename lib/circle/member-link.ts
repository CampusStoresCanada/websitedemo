import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve a Supabase user to a linked Circle member ID via contacts projection.
 */
export async function resolveUserCircleId(userId: string): Promise<number | null> {
  const adminClient = createAdminClient();

  const { data: contact } = await adminClient
    .from("contacts")
    .select("circle_id")
    .eq("user_id", userId)
    .not("circle_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!contact?.circle_id) {
    return null;
  }

  const resolved = Number(contact.circle_id);
  return Number.isFinite(resolved) ? resolved : null;
}
