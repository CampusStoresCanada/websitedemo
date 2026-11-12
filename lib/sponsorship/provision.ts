// System-side, no admin guard: called both from the admin activation action
// and from the Stripe webhook when a sponsorship is paid for, so it lives
// outside lib/actions/sponsorship.ts (see the note in booth-agreement.ts).
import { benefitSlotKeys, resolveAgreementBenefits, type BenefitConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Put up an agreement's placements: one per slot its benefits fill.
 *
 * Reads the agreement's benefits as the tier's plus its own, the same merge
 * getResolvedBenefitsForAgreement shows admins. Until 2026-11 this read only
 * the tier's, so a benefit added to one agreement (or carried in by a
 * sponsorship item) never went up anywhere.
 *
 * Re-runnable: a slot the agreement already has a placement in is left alone,
 * so an admin's edits to it (logo, link, order) survive. Seeds logo and link
 * from the org's profile, and carries the benefit's config (for instance the
 * offsite event a Meet & Greet naming refers to) onto the placement.
 *
 * Returns how many placements it created.
 */
export async function provisionAgreementPlacements(db: Db, agreementId: string): Promise<number> {
  const { data: agreement } = await db
    .from("sponsor_agreements")
    .select("id, tier_id, organization_id, custom_benefits")
    .eq("id", agreementId)
    .maybeSingle();
  if (!agreement) return 0;

  const [tierRes, slotsRes, orgRes, existingRes] = await Promise.all([
    db.from("sponsor_tiers").select("benefits").eq("id", agreement.tier_id).maybeSingle(),
    db.from("sponsor_placement_slots").select("id, key").eq("is_active", true),
    db.from("organizations").select("logo_url, website").eq("id", agreement.organization_id).maybeSingle(),
    db.from("sponsor_placements").select("slot_id").eq("agreement_id", agreementId),
  ]);

  const benefits = resolveAgreementBenefits(
    (tierRes.data?.benefits as BenefitConfig[] | null) ?? [],
    (agreement.custom_benefits as BenefitConfig[] | null) ?? []
  ).all;
  const slotByKey = new Map<string, string>(
    ((slotsRes.data ?? []) as Array<{ id: string; key: string }>).map((s) => [s.key, s.id])
  );
  const taken = new Set<string>(((existingRes.data ?? []) as Array<{ slot_id: string }>).map((p) => p.slot_id));
  const org = (orgRes.data ?? {}) as { logo_url?: string | null; website?: string | null };

  const placements: Array<Record<string, unknown>> = [];
  for (const benefit of benefits) {
    for (const slotKey of benefitSlotKeys(benefit.key)) {
      const slotId = slotByKey.get(slotKey);
      if (!slotId || taken.has(slotId)) continue;
      taken.add(slotId);
      placements.push({
        agreement_id: agreementId,
        slot_id: slotId,
        display_order: placements.length,
        is_active: true,
        logo_url: org.logo_url ?? null,
        link_url: org.website ?? null,
        config_json: benefit.config ?? {},
      });
    }
  }

  if (placements.length === 0) return 0;
  const { error } = await db.from("sponsor_placements").insert(placements);
  if (error) throw new Error(`Could not put up placements for agreement ${agreementId}: ${error.message}`);
  return placements.length;
}
