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

/**
 * The Stripe Tax Rate for an event ticket.
 *
 * Mirrors exactly what the QBO side already does for the same sale
 * (resolveMiscReceiptDetails' event_ticket branch): a buyer with an org is
 * taxed at that org's province, and a public buyer falls back to one flat
 * configured rate. Both halves must agree or the receipt won't match the
 * charge — that mismatch is the whole reason this function exists.
 *
 * ⚠️ Treatment caveat: admission to a *physical* event is arguably taxed
 * where the event is held, not where the buyer is. Events carry only a
 * free-text `location` and an `is_virtual` flag, so there's no structured
 * province to drive that, and for a virtual event the recipient's own
 * province is the right answer anyway. Revisit if in-person ticketed events
 * outside Ontario ever start selling — it needs event-level tax config,
 * not a change here.
 */
export async function resolveEventTicketStripeTaxRateId(
  db: ReturnType<typeof createAdminClient>,
  org: { name: string; province: string | null } | null
): Promise<string> {
  if (org) {
    // Having an org but no province is a config error, not a public sale.
    // The QBO side throws here too — quietly falling back to the public rate
    // would charge one thing and book another for the same ticket.
    if (!org.province) {
      throw new Error(
        `"${org.name}" has no province on file — cannot determine its event ticket tax rate. Set it before selling tickets.`
      );
    }
    return resolveMembershipStripeTaxRateId(db, org.province);
  }

  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "stripe_tax_rate_id_public_ticket")
    .maybeSingle();

  if (data?.value) return data.value;

  throw new Error(
    "No Stripe tax rate configured for public event tickets. Set 'stripe_tax_rate_id_public_ticket' in /admin/settings/quickbooks."
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
): Promise<{
  conferenceRatePct: number;
  membershipRatePct: number;
  /** Stripe Tax Rate ids for the same two treatments. The percentages drive
   * what we store on the order; these drive what Stripe actually charges, and
   * the two MUST be kept in step — if the order RPC prices dues at the buyer's
   * province while the checkout session taxes them at the conference's, the
   * customer is charged a different total than the order records. */
  conferenceStripeTaxRateId: string | null;
  membershipStripeTaxRateId: string;
}> {
  const [{ data: conference, error: conferenceError }, { data: org, error: orgError }] =
    await Promise.all([
      db
        .from("conference_instances")
        .select("tax_rate_pct, stripe_tax_rate_id")
        .eq("id", params.conferenceId)
        .single(),
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
    conferenceStripeTaxRateId: conference.stripe_tax_rate_id,
    membershipStripeTaxRateId: await resolveMembershipStripeTaxRateId(db, org.province),
  };
}
