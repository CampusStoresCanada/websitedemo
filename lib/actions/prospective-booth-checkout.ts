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

export async function createProspectiveBoothCheckout(params: {
  conferenceId: string;
  boothEntityId: string;
  companyName: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<Result<{ checkoutUrl: string }>> {
  const companyName = params.companyName.trim();
  const email = params.email.trim().toLowerCase();
  if (!companyName) return { success: false, error: "Company name is required." };
  if (!email || !email.includes("@")) return { success: false, error: "A valid email is required." };

  const db = createAdminClient();

  const [{ data: booth }, { data: conference }] = await Promise.all([
    db
      .from("conference_entities")
      .select("id, name, kind, is_for_sale, price_cents")
      .eq("id", params.boothEntityId)
      .eq("conference_id", params.conferenceId)
      .maybeSingle(),
    db.from("conference_instances").select("end_date").eq("id", params.conferenceId).maybeSingle(),
  ]);

  if (!booth || booth.kind !== "booth" || !booth.is_for_sale) {
    return { success: false, error: "That booth isn't available." };
  }
  if (!conference?.end_date) {
    return { success: false, error: "Conference not found." };
  }

  // Already sold to someone? Booths aren't tier-gated for prospects (they
  // have no org/tier yet), but they're still first-come-first-served.
  const { data: existingPurchase } = await db
    .from("entity_purchases")
    .select("id")
    .eq("offer_entity_id", params.boothEntityId)
    .maybeSingle();
  if (existingPurchase) {
    return { success: false, error: "That booth has already been claimed." };
  }

  const boothPriceCents = booth.price_cents ?? 0;
  const membershipCents = await priceProspectiveMembershipCents(conference.end_date);
  const totalCents = boothPriceCents + membershipCents;

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
          product_data: { name: `Booth ${booth.name}` },
        },
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
      },
    ],
    custom_text: {
      submit: {
        message:
          "This reserves your booth and starts your membership — approval by the CSC board is still required. You'll finish your application right after payment.",
      },
    },
    metadata: {
      checkout_kind: "prospective_booth",
      conference_id: params.conferenceId,
      booth_entity_id: params.boothEntityId,
      company_name: companyName,
      email,
    },
  });

  if (!session.url) {
    return { success: false, error: "Failed to start checkout." };
  }

  const { error: insertError } = await db.from("prospective_booth_payments").insert({
    email,
    company_name: companyName,
    conference_id: params.conferenceId,
    booth_entity_id: params.boothEntityId,
    amount_cents: totalCents,
    stripe_checkout_session_id: session.id,
    status: "pending",
  });
  if (insertError) return { success: false, error: insertError.message };

  return { success: true, data: { checkoutUrl: session.url } };
}
