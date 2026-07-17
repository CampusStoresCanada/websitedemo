// System-triggered — no admin guard (mirrors activateMembershipRenewal's
// pattern: called from the Stripe webhook / dev-complete-checkout path, not
// from a client with a session). Kept out of lib/actions/sponsorship.ts
// (which pulls in requireAdmin and its own transitive chain) so the webhook
// path's module graph stays free of anything vitest can't resolve — see
// the same reasoning in lib/stripe/webhook-processing.ts.
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Connected/Featured/Celebrated are the same physical booth inventory sold at
 * different price points — Connected is the only one sold through self-serve
 * checkout; Featured/Celebrated are admin-managed upgrades applied afterward.
 * So a booth purchase only ever needs to match a tier by its self-serve price
 * (Connected).
 * Creates a draft agreement — an admin reviews and activates it, same as
 * every other partner-approval step in this system. An org gets one
 * agreement per tier, not one per booth — a second booth at the same tier
 * (orgs can now hold more than one) extends the existing agreement's
 * benefits list instead of being silently dropped or duplicating the
 * agreement. No-ops only on an exact retry of the same booth (webhooks can
 * retry).
 */
export async function createSponsorAgreementFromBoothPurchase(params: {
  organizationId: string;
  boothEntityId: string;
  boothEntityName: string;
  boothPriceCents: number;
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data: tier } = await db
    .from("sponsor_tiers")
    .select("id, name")
    .eq("price_cents", params.boothPriceCents)
    .eq("is_active", true)
    .maybeSingle();
  if (!tier) return; // Not a tier-priced booth (e.g. the plain $4,000 Exhibitor booth).

  const newBenefit = {
    key: "conference_exhibitor",
    label: `Conference — Exhibitor Booth #${params.boothEntityName}`,
    config: { reference_id: params.boothEntityId },
  };

  const { data: existing } = await db
    .from("sponsor_agreements")
    .select("id, custom_benefits")
    .eq("organization_id", params.organizationId)
    .eq("tier_id", tier.id)
    .maybeSingle();

  if (existing) {
    const existingBenefits: Array<{ config?: { reference_id?: string } }> = Array.isArray(existing.custom_benefits)
      ? existing.custom_benefits
      : [];
    const alreadyTracked = existingBenefits.some((b) => b?.config?.reference_id === params.boothEntityId);
    if (alreadyTracked) return; // Exact retry of a booth already on this agreement.

    const { error } = await db
      .from("sponsor_agreements")
      .update({ custom_benefits: [...existingBenefits, newBenefit] })
      .eq("id", existing.id);
    if (error) {
      console.error(`createSponsorAgreementFromBoothPurchase (extend) failed for org ${params.organizationId}: ${error.message}`);
    }
    return;
  }

  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { error } = await db.from("sponsor_agreements").insert({
    organization_id: params.organizationId,
    tier_id: tier.id,
    status: "draft",
    start_date: startDate,
    end_date: endDate,
    custom_benefits: [newBenefit],
    notes: `Auto-created from booth purchase (Booth ${params.boothEntityName}, ${tier.name}). Review and activate to provision benefits.`,
  });
  if (error) {
    console.error(`createSponsorAgreementFromBoothPurchase failed for org ${params.organizationId}: ${error.message}`);
  }
}
