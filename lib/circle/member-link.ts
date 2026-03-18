import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve a Supabase user to their linked Circle member ID.
 *
 * Lookup strategy (in order):
 * 1. circle_member_mapping by supabase_user_id — fast, used post-backfill/cutover
 * 2. contacts.email match — works pre-cutover for any user whose contact record
 *    has a circle_id set (either manually or via sync queue)
 *
 * Returns null if the user has no Circle account linked.
 */
export async function resolveUserCircleId(
  userId: string,
  email: string | null
): Promise<number | null> {
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // 1. Check circle_member_mapping by supabase_user_id (populated after backfill)
  const { data: mapping } = await anyDb
    .from("circle_member_mapping")
    .select("circle_member_id")
    .eq("supabase_user_id", userId)
    .limit(1)
    .maybeSingle();

  if (mapping?.circle_member_id) {
    const id = Number(mapping.circle_member_id);
    if (Number.isFinite(id)) return id;
  }

  // 2. Fall back: look up contact by email
  if (!email) return null;

  const { data: contact } = await db
    .from("contacts")
    .select("id, circle_id")
    .eq("email", email)
    .not("circle_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!contact?.circle_id) return null;

  const circleId = Number(contact.circle_id);
  if (!Number.isFinite(circleId)) return null;

  // Write-through: populate the mapping table so future lookups use path 1
  // (fire-and-forget — failure is non-critical)
  void anyDb
    .from("circle_member_mapping")
    .insert({
      supabase_user_id: userId,
      contact_id: contact.id,
      circle_member_id: circleId,
      match_method: "email",
      match_confidence: "high",
      verified: false,
    })
    .then(({ error }: { error: { code?: string; message: string } | null }) => {
      if (error && error.code !== "23505") {
        // 23505 = unique violation (already inserted by concurrent request) — safe to ignore
        console.warn("[circle/member-link] write-through insert failed:", error.message);
      }
    });

  return circleId;
}
