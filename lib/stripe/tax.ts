import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "./client";

// ─────────────────────────────────────────────────────────────────
// Tax rate resolution.
//
// There are exactly TWO tax treatments in this system, and nearly every tax
// bug we've had came from applying one where the other belongs:
//
//   "conference"  — booths, registrations, sponsorships. DESTINATION-based:
//                   taxed where the conference is held, one flat rate for
//                   every buyer regardless of their own province
//                   (conference_instances.tax_rate_pct / stripe_tax_rate_id /
//                   qbo_tax_code_ref).
//   "membership"  — membership + partnership dues. ORIGIN-based: taxed at the
//                   BUYER's own province (the mappings below, mirrored on the
//                   QBO side by resolveMembershipTaxCode in
//                   lib/quickbooks/export.ts).
//
// A single order routinely contains both — a conference order can bundle a
// membership_renewal line, and the prospective-booth checkout sells a booth
// and first-year dues together. Resolve per LINE, never per order: use
// resolveConferenceOrderTaxRates below rather than reaching for one rate.
// ─────────────────────────────────────────────────────────────────

const STRIPE_MEMBERSHIP_TAX_RATE_IDS_KEY = "stripe_membership_tax_rate_ids";
const STRIPE_TAX_RATE_ID_OUTSIDE_CANADA_KEY = "stripe_tax_rate_id_outside_canada";

interface StripeMembershipTaxRateMapping {
  province: string;
  stripeTaxRateId: string;
}

/**
 * Resolve the Stripe Tax Rate object ID for a membership/partnership line
 * item, from the buyer's own province. Configured in
 * /admin/settings/quickbooks as a province → Stripe Tax Rate ID list (same
 * shape/admin surface as the QBO mapping). No silent guessing: a province
 * not in the mapping throws, since mistaxing a real payment is worse than a
 * clear config error a human can fix.
 */
export async function resolveMembershipStripeTaxRateId(
  db: ReturnType<typeof createAdminClient>,
  province: string
): Promise<string> {
  const isOutsideCanada = province.trim().toLowerCase() === "out of canada";

  if (isOutsideCanada) {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", STRIPE_TAX_RATE_ID_OUTSIDE_CANADA_KEY)
      .single();
    if (data?.value) return data.value;
  } else {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", STRIPE_MEMBERSHIP_TAX_RATE_IDS_KEY)
      .single();

    if (data?.value) {
      try {
        const mappings: StripeMembershipTaxRateMapping[] = JSON.parse(data.value);
        const match = mappings.find((m) => m.province.trim().toLowerCase() === province.trim().toLowerCase());
        if (match?.stripeTaxRateId) return match.stripeTaxRateId;
      } catch {
        // fall through to error below
      }
    }
  }

  throw new Error(
    `No Stripe tax rate configured for province "${province}". Set it in /admin/settings/quickbooks.`
  );
}

// The Stripe Tax Rate object is the single source of truth for the numeric
// percentage — deliberately NOT a third province→percentage mapping in
// app_settings alongside the Stripe-id and QBO-code ones, which would be a
// third thing to keep in sync and a third thing to get wrong. Cached per
// process: tax rate objects are immutable in Stripe (a "change" is a new
// object with a new id), so a cached percentage can never go stale.
const ratePctByStripeTaxRateId = new Map<string, number>();

/**
 * The membership/partnership tax rate, as a percentage, for a buyer in this
 * province — the numeric form of resolveMembershipStripeTaxRateId, for
 * callers that need to compute cents themselves (the cart RPC) rather than
 * hand Stripe a tax_rates id.
 */
export async function resolveMembershipTaxRatePct(
  db: ReturnType<typeof createAdminClient>,
  province: string
): Promise<number> {
  const rateId = await resolveMembershipStripeTaxRateId(db, province);

  const cached = ratePctByStripeTaxRateId.get(rateId);
  if (cached !== undefined) return cached;

  const rate = await stripe.taxRates.retrieve(rateId);
  const pct = Number(rate.percentage);
  if (!Number.isFinite(pct)) {
    throw new Error(`Stripe tax rate ${rateId} has no usable percentage (province "${province}").`);
  }

  ratePctByStripeTaxRateId.set(rateId, pct);
  return pct;
}

/**
 * Both rates a conference order can need, resolved together.
 *
 * Call this instead of reading conference.tax_rate_pct on its own — that's
 * the shape that produced the bug where every bundled membership-renewal
 * line was taxed at the conference's rate instead of the buyer's province
 * (a BC partner charged 13% ON HST on dues that should have been 5% GST).
 */
export async function resolveConferenceOrderTaxRates(
  db: ReturnType<typeof createAdminClient>,
  params: { conferenceId: string; organizationId: string }
): Promise<{ conferenceRatePct: number; membershipRatePct: number }> {
  const [{ data: conference, error: conferenceError }, { data: org, error: orgError }] =
    await Promise.all([
      db.from("conference_instances").select("tax_rate_pct").eq("id", params.conferenceId).single(),
      db.from("organizations").select("name, province").eq("id", params.organizationId).single(),
    ]);

  if (conferenceError || !conference) throw new Error(`Conference not found: ${params.conferenceId}`);
  if (orgError || !org) throw new Error(`Organization not found: ${params.organizationId}`);

  // Same no-silent-guessing rule as resolveMembershipStripeTaxRateId: a
  // missing province is a config error a human can fix in seconds, whereas a
  // silently-assumed rate is a mistaxed real payment nobody notices.
  if (!org.province) {
    throw new Error(
      `"${org.name}" has no province on file — cannot determine its membership tax rate. Set it before checkout.`
    );
  }

  return {
    conferenceRatePct: Number(conference.tax_rate_pct ?? 0),
    membershipRatePct: await resolveMembershipTaxRatePct(db, org.province),
  };
}
