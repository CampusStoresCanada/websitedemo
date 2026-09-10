"use server";

/**
 * Reading and writing a partner's verdicts on their own market.
 *
 * ⛔ THE ONLY DOOR. `market_ratings` has RLS on with no policy, so nothing reaches
 * it through a session client; every read and write goes through here, and every
 * one of them checks the caller against the org in the argument.
 *
 * ⚠️ This is not ordinary directory data. `is_customer` rows are a vendor's
 * customer list — the one thing on this page a competitor would most want. The
 * sibling module `partner-market.ts` shipped for weeks as a `"use server"` export
 * taking an org id with no check at all, which is exactly the mistake to avoid
 * repeating in the module that holds the more sensitive half.
 *
 * ⛔ Who may see them: that partner's own ORG ADMINS, and CSC admins. Nobody else,
 * including other people at the same partner org — reading the market is an
 * org-level perk, but rating it is an org-admin act and so is seeing what was
 * rated. `canManageOrganization` is exactly that test.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, canManageOrganization } from "@/lib/auth/guards";
import type {
  RatingAxis,
  RatingValue,
  RatingRow,
} from "@/lib/match/rating-standing";

/** Which values belong to which axis. Mirrors the table's check constraint. */
const VALUES_BY_AXIS: Record<RatingAxis, readonly RatingValue[]> = {
  fit: ["would_approach", "wrong_time", "not_a_fit"],
  relationship: ["is_customer", "not_customer"],
};

/**
 * Every verdict this partner has recorded, newest first.
 *
 * Returns raw rows rather than a computed standing: staleness depends on `now`,
 * and deciding that here would freeze it at request time for a page that may be
 * cached. `currentStanding` is pure and belongs to the caller.
 */
export async function loadMarketRatings(
  partnerOrgId: string
): Promise<{ ok: boolean; rows: RatingRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, rows: [] };
  if (!canManageOrganization(auth.ctx, partnerOrgId)) {
    // ⚠️ Same shape as "nothing recorded". A refusal that distinguished the two
    // would confirm that a given partner has ratings worth hiding.
    return { ok: false, rows: [] };
  }

  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("market_ratings")
    .select("member_org_id, axis, value, rated_at")
    .eq("partner_org_id", partnerOrgId)
    .order("rated_at", { ascending: false });

  if (error) {
    console.warn(`[market-ratings] read failed for ${partnerOrgId}: ${error.message}`);
    return { ok: false, rows: [] };
  }
  type R = { member_org_id: string; axis: RatingAxis; value: RatingValue; rated_at: string };
  return {
    ok: true,
    rows: ((data ?? []) as R[]).map((r) => ({
      memberOrgId: r.member_org_id,
      axis: r.axis,
      value: r.value,
      ratedAt: r.rated_at,
    })),
  };
}

/**
 * Record one verdict.
 *
 * ⛔ INSERT, never upsert. A changed mind is a new row: overwriting would destroy
 * the only evidence that a partner revised their view, and how long it took them
 * to do it is one of the more interesting things this table will ever hold.
 *
 * ⛔ Captures `run_id` and `rank_at_rating` from the caller, because a verdict is
 * about what the engine said at that position on that night. Tonight's re-rank
 * must not be able to reattribute it.
 */
export async function recordMarketRating(params: {
  partnerOrgId: string;
  memberOrgId: string;
  axis: RatingAxis;
  value: RatingValue;
  runId: string | null;
  rank: number | null;
}): Promise<{ ok: boolean }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false };
  if (!canManageOrganization(auth.ctx, params.partnerOrgId)) return { ok: false };

  // ⚠️ Validate the pairing here as well as in the constraint. The database would
  // reject a mismatch, but only after the row had been built from a value this
  // process accepted — and a fit verdict stored on the relationship axis would
  // silently suppress a store from prospecting.
  if (!VALUES_BY_AXIS[params.axis]?.includes(params.value)) {
    console.warn(`[market-ratings] rejected ${params.axis}/${params.value}`);
    return { ok: false };
  }

  const db = createAdminClient();

  // Who is doing the rating, at their own org. ⛔ Not resolved by email or by
  // profile alone: `contacts` is per (person, org), so the row is scoped to the
  // org being rated — the same human at two orgs is two contacts, and crediting
  // the wrong one would misattribute a commercial judgement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: me } = await (db as any)
    .from("contacts")
    .select("id")
    .eq("organization_id", params.partnerOrgId)
    .eq("profile_id", auth.ctx.userId)
    .is("archived_at", null)
    .limit(2);
  const contacts = (me ?? []) as { id: string }[];
  const ratedBy = contacts.length === 1 ? contacts[0].id : null;

  /**
   * ⛔ WHOSE claim this is, recorded explicitly.
   *
   * `rated_by` resolves a contact at the partner org, so it is null for CSC staff
   * — who have no contact row there — and every CSC rating would otherwise land
   * anonymous and indistinguishable from the partner's own.
   *
   * The difference is the entire value of this table. A partner saying "already a
   * customer" is ground truth about their own book of business; CSC staff saying
   * it is an educated guess. Folding the two together means the evaluation set
   * quietly contains our own assumptions scored as evidence.
   */
  const ratedAs: "org_admin" | "csc_admin" =
    auth.ctx.orgAdminOrgIds.includes(params.partnerOrgId) ? "org_admin" : "csc_admin";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("market_ratings").insert({
    partner_org_id: params.partnerOrgId,
    member_org_id: params.memberOrgId,
    axis: params.axis,
    value: params.value,
    run_id: params.runId,
    rank_at_rating: params.rank,
    rated_by: ratedBy,
    rated_as: ratedAs,
    rated_by_profile: auth.ctx.userId,
  });

  if (error) {
    console.warn(`[market-ratings] write failed for ${params.partnerOrgId}: ${error.message}`);
    return { ok: false };
  }
  return { ok: true };
}
