"use server";

// ─────────────────────────────────────────────────────────────────
// Sponsorship Platform — Server Actions
// ─────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { mirrorFieldsToMembership } from "@/lib/membership/mirror";

// NOTE: sponsor_* tables are new — not yet in database.types.ts.
// The `db` cast below removes Supabase's generated-type strictness for these
// tables only. Remove cast after running `supabase gen types` post-migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sponsorDb(): any { return createAdminClient(); }

import type {
  SponsorTier,
  SponsorAgreement,
  SponsorAgreementWithMeta,
  SponsorAgreementStatus,
  SponsorPlacementSlot,
  SponsorPlacement,
  SponsorPlacementWithContext,
  ActiveSponsor,
  CreateSponsorTierPayload,
  UpdateSponsorTierPayload,
  CreateSponsorAgreementPayload,
  UpdateSponsorAgreementPayload,
  CreatePlacementSlotPayload,
  UpdatePlacementSlotPayload,
  CreateSponsorPlacementPayload,
  UpdateSponsorPlacementPayload,
} from "@/lib/sponsorship/types";
import {
  AGREEMENT_STATUS_TRANSITIONS,
  resolveAgreementBenefits,
} from "@/lib/sponsorship/types";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ─────────────────────────────────────────────────────────────────
// TIERS
// ─────────────────────────────────────────────────────────────────

export async function listSponsorTiers(includeInactive = false): Promise<Result<SponsorTier[]>> {
  const db = sponsorDb();
  let q = db.from("sponsor_tiers").select("*").order("display_order");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorTier[] };
}

export async function getSponsorTier(id: string): Promise<Result<SponsorTier>> {
  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_tiers")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorTier };
}

export async function createSponsorTier(
  payload: CreateSponsorTierPayload
): Promise<Result<SponsorTier>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_tiers")
    .insert(payload)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: data as SponsorTier };
}

export async function updateSponsorTier(
  id: string,
  payload: UpdateSponsorTierPayload
): Promise<Result<SponsorTier>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_tiers")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  revalidatePath("/sponsors");
  return { success: true, data: data as SponsorTier };
}

export async function deleteSponsorTier(id: string): Promise<Result<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  // Block deletion if any agreements reference this tier
  const db = sponsorDb();
  const { count } = await db
    .from("sponsor_agreements")
    .select("id", { count: "exact", head: true })
    .eq("tier_id", id);
  if ((count ?? 0) > 0)
    return { success: false, error: "Cannot delete a tier that has active or historical agreements." };

  const { error } = await db.from("sponsor_tiers").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: undefined };
}

// ─────────────────────────────────────────────────────────────────
// AGREEMENTS
// ─────────────────────────────────────────────────────────────────

export async function listSponsorAgreements(filters?: {
  status?: SponsorAgreementStatus;
  organization_id?: string;
  tier_id?: string;
}): Promise<Result<SponsorAgreementWithMeta[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  let q = db
    .from("sponsor_agreements")
    .select(`
      *,
      tier:sponsor_tiers ( id, name, slug, color, icon ),
      organization:organizations ( id, name, logo_url, slug, website )
    `)
    .order("created_at", { ascending: false });

  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.organization_id) q = q.eq("organization_id", filters.organization_id);
  if (filters?.tier_id) q = q.eq("tier_id", filters.tier_id);

  const { data, error } = await q;
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorAgreementWithMeta[] };
}

export async function getSponsorAgreement(id: string): Promise<Result<SponsorAgreementWithMeta>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_agreements")
    .select(`
      *,
      tier:sponsor_tiers ( id, name, slug, color, icon ),
      organization:organizations ( id, name, logo_url, slug, website )
    `)
    .eq("id", id)
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorAgreementWithMeta };
}

export async function createSponsorAgreement(
  payload: CreateSponsorAgreementPayload
): Promise<Result<SponsorAgreement>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  // Enforce max_sponsors on the tier
  const db = sponsorDb();
  const { data: tier } = await db
    .from("sponsor_tiers")
    .select("max_sponsors, name")
    .eq("id", payload.tier_id)
    .single();

  if (tier?.max_sponsors != null) {
    const { count } = await db
      .from("sponsor_agreements")
      .select("id", { count: "exact", head: true })
      .eq("tier_id", payload.tier_id)
      .in("status", ["draft", "active"]);
    if ((count ?? 0) >= tier.max_sponsors) {
      return {
        success: false,
        error: `The ${tier.name} tier is limited to ${tier.max_sponsors} sponsor(s). All slots are taken.`,
      };
    }
  }

  const { data, error } = await db
    .from("sponsor_agreements")
    .insert({ ...payload, status: "draft", created_by: auth.ctx.userId })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: data as SponsorAgreement };
}

export async function updateSponsorAgreement(
  id: string,
  payload: UpdateSponsorAgreementPayload
): Promise<Result<SponsorAgreement>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_agreements")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: data as SponsorAgreement };
}

export async function transitionAgreementStatus(
  id: string,
  toStatus: SponsorAgreementStatus
): Promise<Result<SponsorAgreement>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data: current, error: fetchError } = await db
    .from("sponsor_agreements")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError) return { success: false, error: fetchError.message };

  const allowed = AGREEMENT_STATUS_TRANSITIONS[current.status as SponsorAgreementStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      success: false,
      error: `Cannot transition from '${current.status}' to '${toStatus}'.`,
    };
  }

  const updates: Record<string, unknown> = {
    status: toStatus,
    updated_at: new Date().toISOString(),
  };

  // On activation: auto-provision placements from tier benefits, seeded with org data
  if (toStatus === "active") {
    await _provisionTierPlacements(id, current.tier_id, current.organization_id, db);
  }

  // On expiry/cancellation: deactivate all placements
  if (toStatus === "expired" || toStatus === "cancelled") {
    await db
      .from("sponsor_placements")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("agreement_id", id);
  }

  const { data, error } = await db
    .from("sponsor_agreements")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/sponsorships");
  revalidatePath("/sponsors");
  revalidatePath("/partners");
  revalidatePath("/");
  return { success: true, data: data as SponsorAgreement };
}

/** Auto-create placements for all website/automatic benefit keys when an agreement activates.
 *  Seeds logo_url and link_url from the org's existing profile data so the admin
 *  doesn't have to re-enter information we already have. */
async function _provisionTierPlacements(
  agreementId: string,
  tierId: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<void> {
  const [tierRes, slotsRes, orgRes] = await Promise.all([
    db.from("sponsor_tiers").select("benefits").eq("id", tierId).single(),
    db.from("sponsor_placement_slots").select("id, key").eq("is_active", true),
    db.from("organizations").select("logo_url, website").eq("id", organizationId).single(),
  ]);

  if (!tierRes.data) return;
  const tier = tierRes.data;
  const slots = slotsRes.data ?? [];
  const org = orgRes.data ?? {};

  const slotByKey = Object.fromEntries(slots.map((s: { id: string; key: string }) => [s.key, s.id]));

  // Map benefit keys → slot keys (1:1 by convention where they share a key)
  const benefitsToProvision = (tier.benefits as Array<{ key: string }>) ?? [];
  const placements = benefitsToProvision
    .filter((b) => slotByKey[b.key])
    .map((b, i) => ({
      agreement_id: agreementId,
      slot_id: slotByKey[b.key],
      display_order: i,
      is_active: true,
      // Pre-seed from org profile — admin can override per placement
      logo_url: org.logo_url ?? null,
      link_url: org.website ?? null,
      config_json: {},
    }));

  if (placements.length > 0) {
    await db.from("sponsor_placements").insert(placements);
  }
}

// ─────────────────────────────────────────────────────────────────
// PLACEMENT SLOTS (registry)
// ─────────────────────────────────────────────────────────────────

export async function listPlacementSlots(includeInactive = false): Promise<Result<SponsorPlacementSlot[]>> {
  const db = sponsorDb();
  let q = db.from("sponsor_placement_slots").select("*").order("display_order");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorPlacementSlot[] };
}

export async function createPlacementSlot(
  payload: CreatePlacementSlotPayload
): Promise<Result<SponsorPlacementSlot>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_placement_slots")
    .insert(payload)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: data as SponsorPlacementSlot };
}

export async function updatePlacementSlot(
  id: string,
  payload: UpdatePlacementSlotPayload
): Promise<Result<SponsorPlacementSlot>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_placement_slots")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: data as SponsorPlacementSlot };
}

// ─────────────────────────────────────────────────────────────────
// PLACEMENTS
// ─────────────────────────────────────────────────────────────────

export async function listPlacementsForAgreement(
  agreementId: string
): Promise<Result<SponsorPlacementWithContext[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_placements")
    .select(`
      *,
      slot:sponsor_placement_slots ( id, key, label, location ),
      agreement:sponsor_agreements (
        id, organization_id,
        tier:sponsor_tiers ( id, name, slug, color, icon ),
        organization:organizations ( id, name, logo_url, slug )
      )
    `)
    .eq("agreement_id", agreementId)
    .order("display_order");
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SponsorPlacementWithContext[] };
}

/**
 * Public: fetch all active placements for a given slot key on a given date.
 * Used by page renderers — no auth required.
 * Date defaults to today.
 */
export async function getActivePlacementsForSlot(
  slotKey: string,
  onDate?: string   // YYYY-MM-DD, defaults to today
): Promise<Result<SponsorPlacementWithContext[]>> {
  const date = onDate ?? new Date().toISOString().slice(0, 10);
  const db = sponsorDb();

  const { data, error } = await db
    .from("sponsor_placements")
    .select(`
      *,
      slot:sponsor_placement_slots ( id, key, label, location ),
      agreement:sponsor_agreements (
        id, organization_id, status, start_date, end_date,
        tier:sponsor_tiers ( id, name, slug, color, icon ),
        organization:organizations ( id, name, logo_url, slug )
      )
    `)
    .eq("is_active", true)
    .order("display_order");

  if (error) return { success: false, error: error.message };

  // Filter: slot key match + agreement active on date
  const filtered = (data ?? []).filter((p: any) =>
    p.slot?.key === slotKey &&
    p.agreement?.status === "active" &&
    p.agreement?.start_date <= date &&
    p.agreement?.end_date >= date
  );

  return { success: true, data: filtered as SponsorPlacementWithContext[] };
}

/**
 * Public: get all active sponsors with all their placements, grouped by org.
 * Used by /sponsors page and homepage sponsor sections.
 */
export async function getActiveSponsors(onDate?: string): Promise<Result<ActiveSponsor[]>> {
  const date = onDate ?? new Date().toISOString().slice(0, 10);
  const db = sponsorDb();

  const { data, error } = await db
    .from("sponsor_agreements")
    .select(`
      id, organization_id, start_date, end_date, status,
      tier:sponsor_tiers ( name, slug, color, icon ),
      organization:organizations ( id, name, logo_url, slug ),
      placements:sponsor_placements (
        id, slot_id, logo_url, link_url, display_order, config_json, is_active,
        slot:sponsor_placement_slots ( key )
      )
    `)
    .eq("status", "active")
    .lte("start_date", date)
    .gte("end_date", date);

  if (error) return { success: false, error: error.message };

  const sponsors: ActiveSponsor[] = (data ?? []).map((a: any) => ({
    agreementId: a.id,
    organizationId: a.organization_id,
    organizationName: a.organization?.name ?? "",
    organizationSlug: a.organization?.slug ?? "",
    organizationLogoUrl: a.organization?.logo_url ?? null,
    tier: {
      name: a.tier?.name ?? "",
      slug: a.tier?.slug ?? "",
      color: a.tier?.color ?? null,
      icon: a.tier?.icon ?? null,
    },
    placements: (a.placements ?? [])
      .filter((p: any) => p.is_active)
      .map((p: any) => ({
        slotKey: p.slot?.key ?? "",
        logoUrl: p.logo_url,
        linkUrl: p.link_url,
        displayOrder: p.display_order,
        config: p.config_json ?? {},
      })),
  }));

  return { success: true, data: sponsors };
}

export async function createSponsorPlacement(
  payload: CreateSponsorPlacementPayload
): Promise<Result<SponsorPlacement>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_placements")
    .insert(payload)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  revalidatePath("/sponsors");
  return { success: true, data: data as SponsorPlacement };
}

export async function updateSponsorPlacement(
  id: string,
  payload: UpdateSponsorPlacementPayload
): Promise<Result<SponsorPlacement>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("sponsor_placements")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  revalidatePath("/sponsors");
  revalidatePath("/partners");
  revalidatePath("/");
  return { success: true, data: data as SponsorPlacement };
}

export async function deleteSponsorPlacement(id: string): Promise<Result<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { error } = await db.from("sponsor_placements").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/sponsorships");
  return { success: true, data: undefined };
}

// ─────────────────────────────────────────────────────────────────
// CANCOLL — org flag helpers
// ─────────────────────────────────────────────────────────────────

export async function setCANCOLLMembership(
  organizationId: string,
  isMember: boolean,
  tier?: string | null
): Promise<Result<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { error } = await db
    .from("organizations")
    .update({
      is_cancoll_member: isMember,
      cancoll_tier: isMember ? (tier ?? null) : null,
    })
    .eq("id", organizationId);
  if (error) return { success: false, error: error.message };

  // Phase 4 Stage 2a: mirror the cancoll flags into `memberships` so they
  // don't drift from `organizations` ahead of the Stage 2 billing cutover
  // (CANCOLL status feeds pricing). Same two columns as the write above.
  await mirrorFieldsToMembership(
    organizationId,
    {
      is_cancoll_member: isMember,
      cancoll_tier: isMember ? (tier ?? null) : null,
    },
    { source: "setCANCOLLMembership" }
  );

  revalidatePath("/admin/sponsorships");
  return { success: true, data: undefined };
}

export async function listCANCOLLMembers(): Promise<
  Result<Array<{ id: string; name: string; slug: string; cancoll_tier: string | null }>>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = sponsorDb();
  const { data, error } = await db
    .from("organizations")
    .select("id, name, slug, cancoll_tier")
    .eq("is_cancoll_member", true)
    .order("name");
  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// BENEFIT REFERENCE OPTIONS — populates dropdowns in BenefitBuilder
// ─────────────────────────────────────────────────────────────────

export interface BenefitReferenceOptions {
  conferenceInstances: Array<{ id: string; label: string }>;
  offsiteEvents:       Array<{ id: string; label: string }>;
  programItems:        Array<{ id: string; label: string }>;
}

export async function listBenefitReferenceOptions(): Promise<Result<BenefitReferenceOptions>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const [confRes, eventsRes, itemsRes] = await Promise.all([
    db.from("conference_instances")
      .select("id, year, edition_code, status")
      .order("year", { ascending: false })
      .order("edition_code", { ascending: true }),
    db.from("events")
      .select("id, title, starts_at")
      .in("status", ["published", "completed"])
      .order("starts_at", { ascending: false }),
    // Program items moved to the v3 catalog — offer scheduled things (sessions,
    // events, meals, …) as benefit reference targets.
    db.from("conference_entities")
      .select("id, name")
      .in("kind", ["session", "event", "networking", "meal", "meeting"])
      .order("name", { ascending: true }),
  ]);

  return {
    success: true,
    data: {
      conferenceInstances: (confRes.data ?? []).map((c: any) => ({
        id: c.id,
        label: `${c.year}${c.edition_code ? ` ${c.edition_code}` : ""} (${c.status})`,
      })),
      offsiteEvents: (eventsRes.data ?? []).map((e: any) => ({
        id: e.id,
        label: `${e.title} — ${new Date(e.starts_at).toLocaleDateString("en-CA")}`,
      })),
      programItems: (itemsRes.data ?? []).map((p: { id: string; name: string }) => ({
        id: p.id,
        label: p.name,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// ORG SELECT — for agreement create/edit forms
// ─────────────────────────────────────────────────────────────────

export async function listOrgsForSelect(): Promise<
  Result<Array<{ id: string; name: string; slug: string; type: string }>>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("organizations")
    .select("id, name, slug, type")
    .eq("membership_status", "active")
    .order("name");
  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// RESOLVED BENEFITS — convenience helper for UI
// ─────────────────────────────────────────────────────────────────

/**
 * Returns resolved benefits for an agreement (tier defaults merged with
 * custom_benefits overrides). Useful for benefit-gating UI and provisioning.
 */
export async function getResolvedBenefitsForAgreement(agreementId: string) {
  const result = await getSponsorAgreement(agreementId);
  if (!result.success) return result;

  const { data: agreement } = result;
  const tierResult = await getSponsorTier(agreement.tier_id);
  if (!tierResult.success) return tierResult;

  const resolved = resolveAgreementBenefits(
    tierResult.data.benefits,
    agreement.custom_benefits ?? []
  );
  return { success: true as const, data: resolved };
}
