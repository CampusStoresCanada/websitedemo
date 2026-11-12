// System-triggered from the Stripe webhook (and the dev checkout path), like
// booth-agreement.ts, so no admin guard and nothing from lib/actions/.
import { createAdminClient } from "@/lib/supabase/admin";
import { getRenewalConfig } from "../policy/engine";
import { isWithinPreRenewalSkipWindow, nextCycleStartOnOrAfter } from "../membership/renewal-activation";
import { raiseAlertIfNotOpen } from "../ops/alerts";
import { provisionAgreementPlacements } from "./provision";
import type { BenefitConfig } from "./types";

/**
 * The tier every sponsorship bought as its own item sits under. An agreement
 * must name a tier; this one carries no price and no benefits of its own, and
 * is kept inactive so it never appears in a tier picker. Its name is what the
 * public sponsor listings show.
 */
export const SPONSORSHIP_ITEM_TIER_SLUG = "custom";

/**
 * When a sponsorship bought on `startDate` runs to.
 *
 * Set per item: `term_months` on the item's attributes, else CSC's membership
 * year (renewal.cycle_start_month_day, Sep 1), so a sponsorship paid in
 * November 2026 runs to Aug 31, 2027. Bought close to the year's end, inside
 * the same pre-renewal window that sells a partnership the year ahead
 * (renewal.pre_renewal_skip_stub_days), it runs to the end of the NEXT year:
 * otherwise one bought on Aug 31 would run for a day.
 */
export function sponsorshipTermEnd(
  startDate: string,
  cycleStartMonthDay: string,
  termMonths?: number | null,
  preRenewalSkipStubDays = 0
): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  if (termMonths && termMonths > 0) {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + termMonths, start.getUTCDate()));
    end.setUTCDate(end.getUTCDate() - 1);
    return end.toISOString().slice(0, 10);
  }
  const dayAfter = new Date(start);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const nextStart = new Date(`${nextCycleStartOnOrAfter(dayAfter, cycleStartMonthDay)}T00:00:00Z`);
  // Measured from the day after: bought ON the cycle start, the year it starts
  // is the one being sold, and the window must not push it a second year.
  if (isWithinPreRenewalSkipWindow(dayAfter, cycleStartMonthDay, preRenewalSkipStubDays - 1)) {
    nextStart.setUTCFullYear(nextStart.getUTCFullYear() + 1);
  }
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return nextStart.toISOString().slice(0, 10);
}

/** The year-round benefits a catalog item carries, if any (attributes.benefits). */
export function itemYearRoundBenefits(attributes: Record<string, unknown> | null | undefined): BenefitConfig[] {
  const raw = (attributes ?? {}).benefits;
  return Array.isArray(raw) ? (raw as BenefitConfig[]) : [];
}

/**
 * A paid catalog item that carries year-round benefits becomes the buyer's
 * agreement, live at once.
 *
 * Any kind of item: a sponsorship (Kivuto, 2026-11) or a booth that includes
 * logos. Its conference perks are granted by its own connections, as for any
 * purchase; this is only the Sponsors-tab half (Steve, 2026-11-12: year-round
 * benefits head to the Sponsors tab, conference ones are built into the
 * conference, and an item selling both wires them together). An item with no
 * year-round benefits makes no agreement.
 *
 * The review happened when the item was published, so, unlike a tier-priced
 * booth (createSponsorAgreementFromBoothPurchase, which leaves a draft), this
 * creates the agreement active and puts up its placements straight away. The
 * benefits are COPIED: editing the item later must not change a deal sold.
 *
 * Idempotent per order and item: webhooks retry, and a re-run must not create
 * a second agreement or a second set of placements.
 */
export async function createSponsorAgreementFromItemPurchase(params: {
  organizationId: string;
  orderId: string;
  itemEntityId: string;
  itemName: string;
  attributes: Record<string, unknown> | null;
  /** YYYY-MM-DD; defaults to today. */
  startDate?: string;
}): Promise<void> {
  const benefits = itemYearRoundBenefits(params.attributes);
  if (benefits.length === 0) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const marker = `item ${params.itemEntityId} / order ${params.orderId}`;

  const { data: existing } = await db
    .from("sponsor_agreements")
    .select("id")
    .eq("organization_id", params.organizationId)
    .like("notes", `%${marker}%`)
    .maybeSingle();
  if (existing) {
    await provisionAgreementPlacements(db, existing.id);
    return;
  }

  const { data: tier } = await db
    .from("sponsor_tiers")
    .select("id")
    .eq("slug", SPONSORSHIP_ITEM_TIER_SLUG)
    .maybeSingle();
  if (!tier) {
    // Paid, but nothing to hang the agreement on. Never silent: the sponsor
    // has paid for benefits nobody will switch on.
    await raiseAlertIfNotOpen({
      ruleKey: `sponsorship_agreement_missing_tier:${params.orderId}`,
      severity: "critical",
      message:
        `${params.itemName} was paid for (order ${params.orderId}) but no agreement was created: ` +
        `the "${SPONSORSHIP_ITEM_TIER_SLUG}" sponsor tier is missing.`,
      details: { organization_id: params.organizationId, order_id: params.orderId },
    });
    return;
  }

  const attrs = params.attributes ?? {};
  const termMonths = typeof attrs.term_months === "number" ? attrs.term_months : null;
  const startDate = params.startDate ?? new Date().toISOString().slice(0, 10);
  const { cycle_start_month_day, pre_renewal_skip_stub_days } = await getRenewalConfig();
  const endDate = sponsorshipTermEnd(startDate, cycle_start_month_day, termMonths, pre_renewal_skip_stub_days);

  const { data: agreement, error } = await db
    .from("sponsor_agreements")
    .insert({
      organization_id: params.organizationId,
      tier_id: tier.id,
      status: "active",
      start_date: startDate,
      end_date: endDate,
      custom_benefits: benefits,
      notes: `Created live from a paid ${params.itemName} (${marker}).`,
    })
    .select("id")
    .single();
  if (error || !agreement) {
    throw new Error(`Could not create the agreement for ${params.itemName}: ${error?.message ?? "no row"}`);
  }

  await provisionAgreementPlacements(db, agreement.id);
}
