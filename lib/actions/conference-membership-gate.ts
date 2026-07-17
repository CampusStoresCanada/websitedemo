"use server";

import { createAdminClient } from "@/lib/supabase/admin";
// Relative import: this constant lives in a pure module pulled in unmocked by
// vitest, where the "@/" alias isn't resolved (see project notes on the test setup).
import { MEMBERSHIP_RENEWAL_KIND } from "../conference/membership-gate";

/**
 * Idempotently find-or-create the one membership-renewal Offer entity for a
 * conference. Mirrors ensurePolicyEntityForDocument() in
 * lib/actions/conference-legal.ts — a singleton catalog entity that offers
 * (e.g. booths) attach via a `requires` ref.
 *
 * is_for_sale is true so it can ride through the normal cart/checkout
 * machinery, but price_cents is deliberately null — the real price is always
 * computed per-org (see priceMembershipRenewalForOrg in
 * lib/actions/conference-commerce.ts), never read off the catalog row.
 */
export async function ensureMembershipRenewalEntity(
  conferenceId: string
): Promise<{ success: true; data: { id: string } } | { success: false; error: string }> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("conference_entities")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("kind", MEMBERSHIP_RENEWAL_KIND)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return { success: true, data: { id: existing.id } };
  }

  const { data: created, error } = await db
    .from("conference_entities")
    .insert({
      conference_id: conferenceId,
      kind: MEMBERSHIP_RENEWAL_KIND,
      name: "Membership Renewal",
      is_for_sale: true,
      price_cents: null,
      currency: "CAD",
      attributes: {},
    })
    .select("id")
    .single();

  if (error || !created) {
    return { success: false, error: error?.message ?? "Failed to create membership renewal entity." };
  }

  return { success: true, data: { id: created.id } };
}
