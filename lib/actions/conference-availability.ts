"use server";

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Active conference lookup + live booth-tier availability
//
// Deliberately standalone (only dependency is createAdminClient) rather than
// living inside lib/actions/conference-entities.ts — that file is the v3
// entity/offer-graph action layer, which isn't shipped to production yet.
// This module has no dependency on that system beyond querying tables
// (conference_instances, conference_entities, entity_purchases) that already
// exist in the shared database, so it can ship independently.
// ---------------------------------------------------------------------------

export type ActiveConferenceSummary = { id: string; year: number; edition_code: string };

/**
 * The conference currently open for registration, if any — same definition
 * app/api/conference/active/route.ts already uses (that route now just calls
 * this), so there's one source of truth for "what counts as active" instead
 * of two copies of the same query drifting apart.
 */
export async function getActiveConferenceInstance(): Promise<ActiveConferenceSummary | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("conference_instances")
    .select("id, year, edition_code")
    .eq("status", "registration_open")
    .order("registration_open_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ActiveConferenceSummary | null) ?? null;
}

export type BoothTierAvailability = { priceCents: number; total: number; remaining: number };

/**
 * Live remaining count per booth price tier — same "for-sale minus claimed"
 * logic as the anonymousBooths block on the conference hub page, just
 * grouped by price instead of returned as individual booths. Powers
 * SponsorshipLadder's Exhibitor/Connected tiers so "X available" is never a
 * stale, hand-typed number again.
 */
export async function getBoothTierAvailability(conferenceId: string): Promise<BoothTierAvailability[]> {
  const db = createAdminClient();
  const [{ data: boothRows }, { data: purchases }] = await Promise.all([
    db.from("conference_entities").select("id, price_cents")
      .eq("conference_id", conferenceId).eq("kind", "booth").eq("is_for_sale", true),
    db.from("entity_purchases").select("offer_entity_id").eq("conference_id", conferenceId),
  ]);

  const claimedIds = new Set((purchases ?? []).map((p) => p.offer_entity_id).filter(Boolean));
  const totals = new Map<number, number>();
  const remaining = new Map<number, number>();

  for (const b of boothRows ?? []) {
    if (b.price_cents == null) continue;
    totals.set(b.price_cents, (totals.get(b.price_cents) ?? 0) + 1);
    if (!claimedIds.has(b.id)) {
      remaining.set(b.price_cents, (remaining.get(b.price_cents) ?? 0) + 1);
    }
  }

  return [...totals.entries()]
    .map(([priceCents, total]) => ({ priceCents, total, remaining: remaining.get(priceCents) ?? 0 }))
    .sort((a, b) => a.priceCents - b.priceCents);
}
