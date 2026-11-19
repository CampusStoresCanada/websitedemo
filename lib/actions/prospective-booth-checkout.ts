"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { getPartnershipRateCents, applyProration } from "@/lib/stripe/billing";
import {
  computeNewExpiresAt,
  nextCycleStartOnOrAfter,
  cyclesNeededFrom,
  isWithinPreRenewalSkipWindow,
} from "@/lib/membership/renewal-activation";
import { getRenewalConfig } from "@/lib/policy/engine";
import { PROVINCES } from "@/lib/constants/provinces";
import { resolveMembershipStripeTaxRateId } from "@/lib/stripe/tax";
import { directPurchaseAllowed, isDirectPurchaseOnly } from "@/lib/conference/entity-pricing";

/**
 * "Pay first, apply second" for a non-member buying a booth — there is
 * deliberately no requireAuthenticated() here, since there is no user or
 * organization yet. Payment happens up front; the buyer is then routed into
 * the existing public application pipeline (lib/actions/applications.ts) to
 * finish applying, with a paid flag riding along so admin review sees it.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * The membership-dues portion of a brand-new prospect's bundle. A booth
 * buyer always joins as a Vendor Partner (partnership dues are flat-rate,
 * unlike FTE-tiered Member dues, so there's no tier to look up for an org
 * that doesn't exist yet). This mirrors the "no backlog" branches of
 * priceMembershipRenewalForOrg (lib/actions/conference-commerce.ts) — a
 * prospect has no prior membership history, so the "lapsed with backlog"
 * branch there can never apply; reproducing just the reachable branches here
 * avoids needing an organizationId that doesn't exist yet to call that
 * function directly.
 */
async function priceProspectiveMembershipCents(conferenceEndDate: string): Promise<number> {
  const { cyclesBridged } = await computeNewExpiresAt(null, conferenceEndDate);
  const perCycleCents = await getPartnershipRateCents();

  const { cycle_start_month_day: cycleStartMonthDay, pre_renewal_skip_stub_days: skipStubDays } =
    await getRenewalConfig();
  const now = new Date();
  const cycleStartDate = nextCycleStartOnOrAfter(now, cycleStartMonthDay);

  if (isWithinPreRenewalSkipWindow(now, cycleStartMonthDay, skipStubDays)) {
    const cyclesFromCycleStart = await cyclesNeededFrom(cycleStartDate, conferenceEndDate);
    return perCycleCents * cyclesFromCycleStart;
  }

  const { amountCents: proratedStubCents } = await applyProration(perCycleCents, now);
  return proratedStubCents + perCycleCents * (cyclesBridged - 1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NamedProspect = { id: string; name: string; type: string | null };

/** The prospect record a per-company link points at, or null. */
async function loadProspect(
  db: ReturnType<typeof createAdminClient>,
  prospectOrganizationId: string | null | undefined
): Promise<NamedProspect | null> {
  if (!prospectOrganizationId || !UUID.test(prospectOrganizationId)) return null;
  const { data } = await db
    .from("organizations")
    .select("id, name, type")
    .eq("id", prospectOrganizationId)
    // A partner that has already joined buys from its cart, signed in.
    .eq("type", "Prospective Partner")
    .is("archived_at", null)
    .maybeSingle();
  return data ?? null;
}

/**
 * The named-buyer offers a prospect can buy pay-first, for a per-company link.
 *
 * Some rates are sold only to named buyers and kept off the storefront (the
 * Big Ideas Day rates). A company we have on file as a prospect can be named on
 * one before it has joined; this is what its link shows. Public on purpose:
 * the reader has no account yet, and the id in the link is the only thing that
 * says who they are. Returns null for anything that is not a prospect named on
 * at least one offer, so a guessed or stale link shows the ordinary page.
 *
 * Uses the same predicate createProspectiveBoothCheckout refuses with, so what
 * the link shows and what the checkout sells cannot drift apart.
 */
export async function getNamedProspectOffers(params: {
  conferenceId: string;
  prospectOrganizationId: string;
}): Promise<{ prospect: { id: string; name: string }; offers: Array<{ id: string; name: string; priceCents: number }> } | null> {
  const db = createAdminClient();
  const prospect = await loadProspect(db, params.prospectOrganizationId);
  if (!prospect) return null;

  const { data: rows } = await db
    .from("conference_entities")
    .select("id, name, price_cents, attributes")
    .eq("conference_id", params.conferenceId)
    .eq("is_for_sale", false)
    .contains("attributes", { direct_purchase_only: true })
    .order("price_cents");

  const offers = (rows ?? [])
    .filter((row) => {
      const attributes = (row.attributes as Record<string, unknown> | null) ?? {};
      return isDirectPurchaseOnly(attributes) && directPurchaseAllowed(attributes, prospect, { payingToJoin: true });
    })
    .map((row) => ({ id: row.id, name: row.name, priceCents: row.price_cents ?? 0 }));

  if (offers.length === 0) return null;
  return { prospect: { id: prospect.id, name: prospect.name }, offers };
}

export async function createProspectiveBoothCheckout(params: {
  conferenceId: string;
  boothEntityId: string;
  companyName: string;
  email: string;
  province: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Set by a per-company link: the prospect record this buyer is. It is what
   * lets a named-buyer offer through, and the company name is then taken from
   * the record rather than the form.
   */
  prospectOrganizationId?: string;
}): Promise<Result<{ checkoutUrl: string }>> {
  const typedCompanyName = params.companyName.trim();
  const email = params.email.trim().toLowerCase();
  const province = params.province.trim();
  if (!email || !email.includes("@")) return { success: false, error: "A valid email is required." };
  if (province !== "Out of Canada" && !PROVINCES.includes(province as (typeof PROVINCES)[number])) {
    return { success: false, error: "A valid province is required." };
  }

  const db = createAdminClient();

  const [{ data: booth }, { data: conference }] = await Promise.all([
    db
      .from("conference_entities")
      .select("id, name, kind, is_for_sale, price_cents, attributes")
      .eq("id", params.boothEntityId)
      .eq("conference_id", params.conferenceId)
      .maybeSingle(),
    db
      .from("conference_instances")
      .select("end_date, stripe_tax_rate_id")
      .eq("id", params.conferenceId)
      .maybeSingle(),
  ]);

  if (!booth) return { success: false, error: "That isn't available to buy." };

  // An offer kept off the storefront is sold here only to a prospect it names.
  // Same predicate getNamedProspectOffers shows it with.
  const prospect = await loadProspect(db, params.prospectOrganizationId);
  if (!booth.is_for_sale) {
    const attributes = (booth.attributes as Record<string, unknown> | null) ?? {};
    const named =
      isDirectPurchaseOnly(attributes) && directPurchaseAllowed(attributes, prospect, { payingToJoin: true });
    if (!named) return { success: false, error: "That isn't available to buy." };
  }

  // The name on file, not the one typed: approval matches this payment's
  // application back to the prospect record by company name, so a different
  // spelling would start a second organization beside it.
  const companyName = prospect?.name ?? typedCompanyName;
  if (!companyName) return { success: false, error: "Company name is required." };
  const isBooth = booth.kind === "booth";
  if (!conference?.end_date) {
    return { success: false, error: "Conference not found." };
  }
  // The booth is a destination-based supply — taxed where the conference is
  // held, at the same flat rate every other booth sale uses. This line carried
  // no tax_rates at all until 2026-08-17, so prospects paid no HST on the
  // booth while the QBO receipt booked it anyway. Refuse the sale rather than
  // silently under-collecting again (same rule as resolveMembershipStripeTaxRateId).
  if (!conference.stripe_tax_rate_id) {
    return {
      success: false,
      error: "This conference has no Stripe tax rate configured — set it on the conference's Tax fieldset before selling booths.",
    };
  }

  // Already sold to someone? Booths aren't tier-gated for prospects (they
  // have no org/tier yet), but they're still first-come-first-served.
  //
  // Exclusivity is a property of a BOOTH — one physical space, one buyer.
  // Conference in a Box has no such limit: every partner who wants one gets
  // one, so checking "has anyone bought this entity" would refuse every buyer
  // after the first. mint_prospective_booth_purchase carries the same guard
  // and is scoped the same way.
  if (isBooth) {
    const { data: existingPurchase } = await db
      .from("entity_purchases")
      .select("id")
      .eq("offer_entity_id", params.boothEntityId)
      .maybeSingle();
    if (existingPurchase) {
      return { success: false, error: "That booth has already been claimed." };
    }
  }

  const boothPriceCents = booth.price_cents ?? 0;
  const membershipCents = await priceProspectiveMembershipCents(conference.end_date);
  const totalCents = boothPriceCents + membershipCents;
  const membershipTaxRateId = await resolveMembershipStripeTaxRateId(db, province);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: boothPriceCents,
          product_data: { name: isBooth ? `Booth ${booth.name}` : booth.name },
        },
        // Conference's rate, NOT the buyer's province — see above.
        tax_rates: [conference.stripe_tax_rate_id],
      },
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: membershipCents,
          product_data: {
            name: "CSC Partnership membership",
            description: "Subject to board approval — you'll be prompted to finish your application next.",
          },
        },
        tax_rates: [membershipTaxRateId],
      },
    ],
    custom_text: {
      submit: {
        message: isBooth
          ? "This reserves your booth and starts your membership — approval by the CSC board is still required. You'll finish your application right after payment."
          : "This starts your CSC partnership alongside your purchase — approval by the CSC board is still required. You'll finish your application right after payment.",
      },
    },
    metadata: {
      checkout_kind: "prospective_booth",
      conference_id: params.conferenceId,
      booth_entity_id: params.boothEntityId,
      company_name: companyName,
      email,
      province,
      ...(prospect ? { prospect_organization_id: prospect.id } : {}),
    },
  });

  if (!session.url) {
    return { success: false, error: "Failed to start checkout." };
  }

  const { error: insertError } = await db.from("prospective_booth_payments").insert({
    email,
    company_name: companyName,
    province,
    conference_id: params.conferenceId,
    booth_entity_id: params.boothEntityId,
    amount_cents: totalCents,
    // Persist the split, not just the sum — the two halves are taxed under
    // different rules and the QBO receipt has to post them as separate lines.
    booth_amount_cents: boothPriceCents,
    membership_amount_cents: membershipCents,
    stripe_checkout_session_id: session.id,
    status: "pending",
  });
  if (insertError) return { success: false, error: insertError.message };

  return { success: true, data: { checkoutUrl: session.url } };
}
