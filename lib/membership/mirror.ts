import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramsConfig } from "@/lib/policy/engine";

/**
 * Phase 4 Stage 2a: mirror organization-level membership facts into the
 * matching `memberships` row.
 *
 * Stage 0 made `transition_membership_state()` mirror an org's *lifecycle
 * status* into `memberships`, but left `fte`/`is_cancoll_member`/
 * `cancoll_tier` populated only by the one-time backfill — so every live
 * write path that edits those columns on `organizations` silently drifted
 * the two tables apart. That drift is harmless while `memberships` is
 * read-only for status (Stage 1), but it would mis-price real invoices the
 * moment Stage 2 moves billing reads onto this table. This closes the gap
 * ahead of that cutover.
 *
 * `organizations` remains the sole write authority through Stage 2 — this
 * is strictly an additive, best-effort mirror. It must never fail or block
 * the authoritative write that precedes it, so every error is logged and
 * swallowed rather than thrown.
 */
export interface MembershipMirrorFields {
  fte?: number | null;
  is_cancoll_member?: boolean;
  cancoll_tier?: string | null;
}

export async function mirrorFieldsToMembership(
  organizationId: string,
  fields: MembershipMirrorFields,
  options?: {
    /** Pass the org's `type` when the caller already has it, to skip a lookup. */
    orgType?: string | null;
    /** Label used in warning logs so a failed mirror is traceable to its call site. */
    source?: string;
  }
): Promise<void> {
  const source = options?.source ?? "mirrorFieldsToMembership";

  try {
    if (Object.keys(fields).length === 0) return;

    const db = createAdminClient();

    let orgType = options?.orgType;
    if (orgType === undefined) {
      const { data, error } = await db
        .from("organizations")
        .select("type")
        .eq("id", organizationId)
        .maybeSingle();

      if (error) {
        console.warn(`[${source}] membership mirror: failed to resolve org type:`, error.message);
        return;
      }
      orgType = data?.type ?? null;
    }

    // Resolve program_key the same way the read side does
    // (lib/auth/org-level.ts's resolveMembershipStatus) rather than
    // re-hardcoding the 'Member'/'Vendor Partner' literals. Org types with
    // no configured program ("Non-Member", staff orgs, …) hold no real
    // membership and correctly have no row to mirror into — same behavior
    // as the Stage 0 backfill and the RPC mirror.
    const programs = await getProgramsConfig();
    const programKey = programs.find((p) => p.orgTypeValue === orgType)?.key;
    if (!programKey) return;

    // Update-only, never insert: `memberships.status` is NOT NULL and this
    // helper has no meaningful status to supply. An org that legitimately
    // holds a membership already has its row (Stage 0 backfilled all of
    // them; approveApplication creates one for every new org), so a missing
    // row means "this org holds no membership" — not "create one".
    const { error } = await db
      .from("memberships")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("program_key", programKey);

    if (error) {
      console.warn(`[${source}] membership mirror failed (non-blocking):`, error.message);
    }
  } catch (err) {
    console.warn(`[${source}] membership mirror threw (non-blocking):`, err);
  }
}
