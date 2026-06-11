"use server";

import { requireAuthenticated, requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { ensureStripeCustomer } from "@/lib/stripe/billing";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BoothStatus = "available" | "sponsor_hold" | "reserved" | "sold" | "waitlisted";

export type BoothRow = {
  id: string;
  booth_number: string;
  booth_product_id: string | null;
  map_cx: number;
  map_cy: number;
  map_w: number;
  map_h: number;
  status: BoothStatus;
  organization_id: string | null;
  reserved_until: string | null;
  sold_at: string | null;
  organization_name?: string | null;
};

export type BoothSaleContext = {
  sponsorOpenAt: string | null;
  generalOpenAt: string | null;
  /** Whether the current date allows sponsor-only selection */
  isSponsorWindow: boolean;
  /** Whether general selection is open to all */
  isGeneralOpen: boolean;
  /** Whether the org has an active sponsor_agreement with conference_exhibitor benefit */
  isOrgSponsor: boolean;
  /** Whether booth sales are open AT ALL for this org right now */
  canSelect: boolean;
};

export type ApprovalRow = {
  id: string;
  conference_id: string;
  booth_id: string;
  organization_id: string;
  submitted_by: string;
  line_items: unknown;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  payment_type: "card" | "po";
  po_number: string | null;
  charge_after: string | null;
  status: string;
  approver_1_id: string | null;
  approver_1_at: string | null;
  approver_2_id: string | null;
  approver_2_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  charged_at: string | null;
  charge_error: string | null;
  internal_notes: string | null;
  created_at: string;
  booth_number?: string;
  organization_name?: string;
};

// Helper: typed `.from()` call for a table not yet in generated types.
// Remove the cast once `supabase gen types` is re-run after migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boothsTable(db: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).from("conference_booths");
}

// ─── Public: fetch booths for the floor plan ──────────────────────────────────

export async function getConferenceBooths(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: BoothRow[];
}> {
  const db = createAdminClient();

  // Fetch booths joined to the org name (only when sold/reserved)
  const { data, error } = await boothsTable(db)
    .select("*, organizations(name)")
    .eq("conference_id", conferenceId)
    .order("booth_number");

  if (error) return { success: false, error: error.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: BoothRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    booth_number: row.booth_number,
    booth_product_id: row.booth_product_id,
    map_cx: Number(row.map_cx),
    map_cy: Number(row.map_cy),
    map_w: Number(row.map_w),
    map_h: Number(row.map_h),
    status: row.status as BoothStatus,
    organization_id: row.organization_id,
    reserved_until: row.reserved_until,
    sold_at: row.sold_at,
    organization_name: row.organizations?.name ?? null,
  }));

  return { success: true, data: rows };
}

// ─── Booth sale window + sponsor check ───────────────────────────────────────

export async function getBoothSaleContext(
  conferenceId: string,
  orgId: string
): Promise<{ success: boolean; error?: string; data?: BoothSaleContext }> {
  const db = createAdminClient();
  const now = new Date();

  // Get sale window dates — new columns not in generated types yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conf, error: confErr } = await (db as any)
    .from("conference_instances")
    .select("booth_sales_sponsor_open_at, booth_sales_general_open_at")
    .eq("id", conferenceId)
    .single();

  if (confErr || !conf) return { success: false, error: confErr?.message ?? "Conference not found" };

  const sponsorOpenAt = (conf as Record<string, string | null>).booth_sales_sponsor_open_at;
  const generalOpenAt = (conf as Record<string, string | null>).booth_sales_general_open_at;

  const sponsorTs = sponsorOpenAt ? new Date(sponsorOpenAt.endsWith("Z") || sponsorOpenAt.includes("+") ? sponsorOpenAt : sponsorOpenAt.replace(" ", "T") + "Z") : null;
  const generalTs = generalOpenAt ? new Date(generalOpenAt.endsWith("Z") || generalOpenAt.includes("+") ? generalOpenAt : generalOpenAt.replace(" ", "T") + "Z") : null;

  const isSponsorWindow = !!sponsorTs && now >= sponsorTs && (!generalTs || now < generalTs);
  const isGeneralOpen = !!generalTs && now >= generalTs;

  // Check if org is an active sponsor with the conference_exhibitor benefit
  let isOrgSponsor = false;
  if (isSponsorWindow && !isGeneralOpen) {
    const { data: agreements } = await db
      .from("sponsor_agreements")
      .select("id, custom_benefits, tier_id, sponsor_tiers(benefits)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .lte("start_date", now.toISOString().slice(0, 10))
      .gte("end_date", now.toISOString().slice(0, 10));

    for (const agreement of agreements ?? []) {
      const a = agreement as typeof agreement & { sponsor_tiers?: { benefits: unknown } | null };
      const tierBenefits = a.sponsor_tiers?.benefits;
      const customBenefits = a.custom_benefits;

      const hasConferenceExhibitor = (b: unknown): boolean => {
        if (!b) return false;
        if (Array.isArray(b)) return b.some((x) => x === "conference_exhibitor" || x?.key === "conference_exhibitor");
        if (typeof b === "object") return "conference_exhibitor" in (b as object);
        return false;
      };

      if (hasConferenceExhibitor(tierBenefits) || hasConferenceExhibitor(customBenefits)) {
        isOrgSponsor = true;
        break;
      }
    }
  }

  const canSelect = isGeneralOpen || (isSponsorWindow && isOrgSponsor);

  return {
    success: true,
    data: {
      sponsorOpenAt,
      generalOpenAt,
      isSponsorWindow,
      isGeneralOpen,
      isOrgSponsor,
      canSelect,
    },
  };
}

// ─── Partnership status check ────────────────────────────────────────────────

export async function checkPartnershipStatus(
  orgId: string,
  conferenceYear: number
): Promise<{
  hasCurrentPartnership: boolean;
  expiresAt: string | null;
}> {
  const db = createAdminClient();
  // The conference year is 2027; partnership year is 2026-27.
  // membership_expires_at must be >= the conference start (2027-01-01 is safe).
  const conferenceStart = `${conferenceYear}-01-01`;

  const { data: org } = await db
    .from("organizations")
    .select("membership_status, membership_expires_at")
    .eq("id", orgId)
    .single();

  if (!org) return { hasCurrentPartnership: false, expiresAt: null };

  const isActive =
    org.membership_status === "active" &&
    !!org.membership_expires_at &&
    org.membership_expires_at >= conferenceStart;

  return {
    hasCurrentPartnership: isActive,
    expiresAt: org.membership_expires_at ?? null,
  };
}

// ─── Reserve a booth (soft-hold) ─────────────────────────────────────────────

export async function reserveBooth(boothId: string, orgId: string): Promise<{
  success: boolean;
  error?: string;
  result?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("reserve_booth", {
    p_booth_id: boothId,
    p_org_id: orgId,
  });

  if (error) return { success: false, error: error.message };
  if (data !== "ok") return { success: false, error: (data as string) ?? "unavailable" };
  return { success: true, result: data as string };
}

// ─── Create Stripe SetupIntent for card-on-file ───────────────────────────────

export async function createBoothSetupIntent(orgId: string): Promise<{
  success: boolean;
  error?: string;
  clientSecret?: string;
  customerId?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  try {
    const customerId = await ensureStripeCustomer(orgId);
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { org_id: orgId, purpose: "booth_purchase" },
    });

    return { success: true, clientSecret: intent.client_secret!, customerId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    return { success: false, error: msg };
  }
}

// ─── Submit booth purchase (insert approval row) ──────────────────────────────

export async function submitBoothPurchaseRequest(params: {
  boothId: string;
  orgId: string;
  conferenceId: string;
  lineItems: unknown[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentType: "card" | "po";
  stripeCustomerId?: string;
  stripeSetupIntentId?: string;
  stripePaymentMethodId?: string;
  poNumber?: string;
}): Promise<{ success: boolean; error?: string; approvalId?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("submit_booth_approval_request", {
    p_booth_id: params.boothId,
    p_org_id: params.orgId,
    p_conference_id: params.conferenceId,
    p_line_items: JSON.stringify(params.lineItems),
    p_subtotal_cents: params.subtotalCents,
    p_tax_cents: params.taxCents,
    p_total_cents: params.totalCents,
    p_payment_type: params.paymentType,
    p_stripe_customer_id: params.stripeCustomerId ?? null,
    p_stripe_setup_intent_id: params.stripeSetupIntentId ?? null,
    p_stripe_payment_method_id: params.stripePaymentMethodId ?? null,
    p_po_number: params.poNumber ?? null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, approvalId: data as string };
}

// ─── Admin: list pending approvals ───────────────────────────────────────────

export async function getBoothApprovals(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: ApprovalRow[];
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  // conference_booth_approvals not in generated types yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("conference_booth_approvals")
    .select("*, conference_booths(booth_number), organizations(name)")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: ApprovalRow[] = (data ?? []).map((row: any) => ({
    ...row,
    booth_number: row.conference_booths?.booth_number ?? "—",
    organization_name: row.organizations?.name ?? "—",
  } as ApprovalRow));

  return { success: true, data: rows };
}

// ─── Admin: approve a booth request ──────────────────────────────────────────

export async function approveBoothRequest(
  approvalId: string,
  notes?: string
): Promise<{ success: boolean; error?: string; result?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("approve_booth_request", {
    p_approval_id: approvalId,
    p_notes: notes ?? null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, result: data as string };
}

// ─── Admin: reject a booth request ───────────────────────────────────────────

export async function rejectBoothRequest(
  approvalId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("reject_booth_request", {
    p_approval_id: approvalId,
    p_reason: reason,
  });

  if (error) return { success: false, error: error.message };
  const result = data as string;
  if (result !== "ok") return { success: false, error: result };
  return { success: true };
}

// ─── Get single booth by ID ───────────────────────────────────────────────────

export async function getBoothById(
  boothId: string,
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: BoothRow }> {
  const db = createAdminClient();
  const { data, error } = await boothsTable(db)
    .select("*")
    .eq("id", boothId)
    .eq("conference_id", conferenceId)
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Not found" };

  return {
    success: true,
    data: {
      id: data.id,
      booth_number: data.booth_number,
      booth_product_id: data.booth_product_id,
      map_cx: Number(data.map_cx),
      map_cy: Number(data.map_cy),
      map_w: Number(data.map_w),
      map_h: Number(data.map_h),
      status: data.status as BoothStatus,
      organization_id: data.organization_id,
      reserved_until: data.reserved_until,
      sold_at: data.sold_at,
    },
  };
}

// ─── Admin: get all booths with org details ───────────────────────────────────

export async function getAdminBoothOverview(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: (BoothRow & { approval_count?: number })[];
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await boothsTable(db)
    .select("*, organizations(name)")
    .eq("conference_id", conferenceId)
    .order("booth_number");

  if (error) return { success: false, error: error.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map((row: any) => ({
    id: row.id,
    booth_number: row.booth_number,
    booth_product_id: row.booth_product_id,
    map_cx: Number(row.map_cx),
    map_cy: Number(row.map_cy),
    map_w: Number(row.map_w),
    map_h: Number(row.map_h),
    status: row.status as BoothStatus,
    organization_id: row.organization_id,
    reserved_until: row.reserved_until,
    sold_at: row.sold_at,
    organization_name: row.organizations?.name ?? null,
  }));

  return { success: true, data: rows };
}

// ─── Admin: create a booth ────────────────────────────────────────────────────

export async function createBooth(
  conferenceId: string,
  input: {
    boothNumber: string;
    boothProductId: string | null;
    mapCx: number;
    mapCy: number;
    mapW?: number;
    mapH?: number;
  }
): Promise<{ success: boolean; error?: string; data?: BoothRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await boothsTable(db)
    .insert({
      conference_id: conferenceId,
      booth_number: input.boothNumber,
      booth_product_id: input.boothProductId,
      map_cx: input.mapCx,
      map_cy: input.mapCy,
      map_w: input.mapW ?? 69,
      map_h: input.mapH ?? 55,
    })
    .select("*")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

  return {
    success: true,
    data: {
      id: data.id,
      booth_number: data.booth_number,
      booth_product_id: data.booth_product_id,
      map_cx: Number(data.map_cx),
      map_cy: Number(data.map_cy),
      map_w: Number(data.map_w),
      map_h: Number(data.map_h),
      status: data.status as BoothStatus,
      organization_id: data.organization_id,
      reserved_until: data.reserved_until,
      sold_at: data.sold_at,
    },
  };
}

// ─── Admin: update a booth ────────────────────────────────────────────────────

export async function updateBooth(
  boothId: string,
  patch: Partial<{
    boothNumber: string;
    boothProductId: string | null;
    status: BoothStatus;
    mapCx: number;
    mapCy: number;
    mapW: number;
    mapH: number;
    organizationId: string | null;
  }>
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.boothNumber !== undefined) update.booth_number = patch.boothNumber;
  if (patch.boothProductId !== undefined) update.booth_product_id = patch.boothProductId;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.mapCx !== undefined) update.map_cx = patch.mapCx;
  if (patch.mapCy !== undefined) update.map_cy = patch.mapCy;
  if (patch.mapW !== undefined) update.map_w = patch.mapW;
  if (patch.mapH !== undefined) update.map_h = patch.mapH;
  if (patch.organizationId !== undefined) update.organization_id = patch.organizationId;

  const { error } = await boothsTable(db).update(update).eq("id", boothId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Admin: delete a booth ────────────────────────────────────────────────────

export async function deleteBooth(boothId: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await boothsTable(db).delete().eq("id", boothId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
