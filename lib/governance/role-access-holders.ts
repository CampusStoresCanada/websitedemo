/**
 * Who holds a governance role, for the purpose of OPERATIONAL ACCESS, as at a
 * date.
 *
 * ⛔ ONE answer, shared by every destination. This was written inside
 * `syncGovernanceGroupNow` when the Google group was the only destination a
 * role could feed. Circle spaces are a second destination for the same
 * question, and a second copy of this filter is how the mailing list and the
 * board spaces come to disagree about who is on the board — silently, between
 * AGMs, in the direction nobody checks.
 *
 * ⛔ ACCESS, not the seat. It asks `hasBoardAccessOn`, which brackets the term
 * with the access window, and NOT `holdsOn`, which answers the governance
 * question of who may vote and count toward quorum. They differ at both ends of
 * every cycle: an incoming director let in before their term starts, and an
 * outgoing one kept on through the conference that follows the AGM. Keyed to the
 * same predicate the board register screen uses, so a door and the screen can
 * never disagree.
 *
 * ⛔ Every decision is made as of `asOf`, never the wall clock. The two sides of
 * a changeover happen months apart and the register carries exclusive term
 * dates, so reading "who holds this" against today answers a different question
 * than the one on the screen that triggered the sync.
 */

import { hasBoardAccessOn } from "@/lib/governance/register";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export type RoleAccessHolder = {
  contactId: string | null;
  email: string;
};

export async function roleAccessHolders(
  db: Db,
  bodyKey: string,
  roleKey: string,
  asOf: string
): Promise<{ holders: RoleAccessHolder[]; error: string | null }> {
  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", bodyKey)
    .maybeSingle();
  if (!body) return { holders: [], error: `no governance body "${bodyKey}"` };

  // ⚠️ Filtered in JS rather than in the query on purpose. The rule is
  // `coalesce(access_from, term_start) <= asOf`, which PostgREST cannot express
  // without a view, and duplicating it as a second hand-written filter is
  // exactly how the two drift apart. The table is 56 rows.
  const { data: rows, error } = await db
    .from("governance_role_assignments")
    .select(
      "person_contact_id, term_start, term_end, access_from, access_until, counts_toward_cap, contacts(email)"
    )
    .eq("body_id", body.id)
    .eq("role_key", roleKey);

  if (error) return { holders: [], error: `could not read the register: ${error.message}` };

  const holding = (rows ?? []).filter((r) =>
    hasBoardAccessOn(
      {
        termStart: r.term_start as string,
        termEnd: r.term_end as string | null,
        accessFrom: r.access_from as string | null,
        accessUntil: r.access_until as string | null,
        isNoServiceMarker:
          !r.counts_toward_cap && !!r.term_end && r.term_end === r.term_start,
      },
      asOf
    )
  );

  const seen = new Set<string>();
  const holders: RoleAccessHolder[] = [];
  for (const h of holding) {
    const email = (h.contacts as { email?: string } | null)?.email?.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    holders.push({ contactId: (h.person_contact_id as string | null) ?? null, email });
  }

  return { holders, error: null };
}

/**
 * Everyone who has EVER held this role, whatever the dates say.
 *
 * ⛔ NOT `roleAccessHolders` with a far-future date. `hasBoardAccessOn` is a
 * point-in-time predicate: a term that ended in 2026 is not "holding" in 9999
 * either, so a sentinel date returns nobody. That mistake made a removal path
 * that could never fire, and only a test caught it.
 *
 * This is the allow-list for REMOVALS. A board Circle space legitimately holds
 * staff, the Executive Director and five Ghost accounts; a reconciler that
 * removed everyone it did not want would empty the space of people a human put
 * there on purpose. So removals are limited to people the register has a record
 * of holding this role.
 */
export async function roleEverHeldBy(
  db: Db,
  bodyKey: string,
  roleKey: string
): Promise<RoleAccessHolder[]> {
  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", bodyKey)
    .maybeSingle();
  if (!body) return [];

  const { data: rows } = await db
    .from("governance_role_assignments")
    .select("person_contact_id, contacts(email)")
    .eq("body_id", body.id)
    .eq("role_key", roleKey);

  const seen = new Set<string>();
  const out: RoleAccessHolder[] = [];
  for (const r of rows ?? []) {
    const email = (r.contacts as { email?: string } | null)?.email?.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ contactId: (r.person_contact_id as string | null) ?? null, email });
  }
  return out;
}
