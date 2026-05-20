"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PartnerOrgProfile {
  primaryCategory: string | null;
  certifications: string[];
}

export interface MemberOrgProfile {
  /** Product categories this store carries (from procurement_info.category_buyers) */
  categories: string[];
  /** Vendor certification preferences (Buy Canadian, Indigenous Owned, etc.) */
  preferredCertifications: string[];
  /**
   * True only when the store has declared at least one product category.
   * Empty categories = partners can't be scored, nudge should show.
   * Deliberately ignores certs/provinces/buying_cycle — those don't drive
   * partner fit scoring on their own.
   */
  hasCategoryData: boolean;
  /** Whether the current user is the org_admin (store director) of their member org */
  isOrgAdmin: boolean;
  /** Org slug — used to build the admin link for org_admins */
  orgSlug: string | null;
  /** Contact ID of the primary contact — used to build the Circle profile link for non-admins */
  primaryContactId: string | null;
  /** Display name of the primary contact — used in the nudge banner */
  primaryContactName: string | null;
}

export interface ProcurementContactEntry {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

export interface ProcurementPanelData {
  /**
   * The buyer assigned to the partner's primary category at this member org.
   * null = partner's category isn't in this member's carry list at all.
   * { category, contact: null } = category is carried but no buyer assigned yet.
   */
  categoryBuyer: {
    category: string;
    contact: ProcurementContactEntry | null;
  } | null;
  preferredCertifications: string[];
  buyingWindow: {
    rfpStart: string | null;
    rfpEnd: string | null;
    fiscalYearStart: string | null;
  } | null;
  sourcingProvinces: string[];
}

/**
 * Returns the logged-in partner's own org profile data needed to compute
 * fit scoring against member organizations in the directory table.
 *
 * Returns null if the user is not authenticated or has no partner org.
 */
export async function getPartnerOrgProfile(): Promise<PartnerOrgProfile | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = auth.ctx.supabase as any;

  const { data: memberships } = await supabase
    .from("user_organizations")
    .select("organization:organizations(primary_category, certifications)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  if (!memberships || memberships.length === 0) return null;

  for (const row of memberships) {
    const org = row.organization;
    if (!org) continue;
    return {
      primaryCategory: (org.primary_category as string | null) ?? null,
      certifications: Array.isArray(org.certifications)
        ? (org.certifications as string[])
        : [],
    };
  }

  return null;
}

/**
 * Fetches procurement panel data for a member org, scoped to a partner's
 * primary category. Returns the buyer contact for that category (if assigned),
 * vendor preferences, buying window, and sourcing provinces.
 *
 * Uses admin client since procurement_info is not publicly readable.
 */
export async function getOrgProcurementPanel(
  orgId: string,
  partnerCategory: string | null,
): Promise<ProcurementPanelData | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  // Fetch the org's procurement_info
  const { data: orgRow } = await db
    .from("organizations")
    .select("procurement_info")
    .eq("id", orgId)
    .maybeSingle();

  if (!orgRow) return null;

  const pi = orgRow.procurement_info as Record<string, unknown> | null;
  if (!pi) return { categoryBuyer: null, preferredCertifications: [], buyingWindow: null, sourcingProvinces: [] };

  // Preferred certifications (respect visibility flag)
  const showCerts = pi.show_certifications !== false;
  const preferredCertifications = showCerts && Array.isArray(pi.preferred_certifications)
    ? (pi.preferred_certifications as string[])
    : [];

  // Buying window (respect visibility flag)
  const showCycle = pi.show_buying_cycle !== false;
  const bc = pi.buying_cycle as Record<string, unknown> | null | undefined;
  const buyingWindow = showCycle && bc ? {
    rfpStart: typeof bc.rfp_start === "string" ? bc.rfp_start : null,
    rfpEnd: typeof bc.rfp_end === "string" ? bc.rfp_end : null,
    fiscalYearStart: typeof bc.fiscal_year_start === "string" ? bc.fiscal_year_start : null,
  } : null;

  // Sourcing provinces (respect visibility flag)
  const showProvinces = pi.show_provinces !== false;
  const sourcingProvinces = showProvinces && Array.isArray(pi.sourcing_provinces)
    ? (pi.sourcing_provinces as string[])
    : [];

  // Category buyer for partner's specific category
  const showCategories = pi.show_categories !== false;
  let categoryBuyer: ProcurementPanelData["categoryBuyer"] = null;

  if (showCategories && partnerCategory && Array.isArray(pi.category_buyers)) {
    const entry = (pi.category_buyers as Array<Record<string, unknown>>)
      .find((b) => b.category === partnerCategory);

    if (entry) {
      categoryBuyer = { category: partnerCategory, contact: null };
      const contactIds = Array.isArray(entry.contact_ids) ? (entry.contact_ids as string[]) : [];

      if (contactIds.length > 0) {
        // Fetch contacts by ID — exclude hidden ones
        const { data: contactRows } = await db
          .from("contacts")
          .select("id, name, role_title, work_email, email, work_phone_number, phone, profile_picture_url, hidden")
          .in("id", contactIds)
          .is("archived_at", null)
          .not("hidden", "eq", true) // exclude explicitly hidden; allow NULL (not hidden) and false
          .order("name")
          .limit(1); // take the first non-hidden contact for this category

        if (contactRows && contactRows.length > 0) {
          const c = contactRows[0] as Record<string, unknown>;
          categoryBuyer.contact = {
            id: String(c.id),
            name: String(c.name ?? ""),
            roleTitle: (c.role_title as string | null) ?? null,
            email: (c.work_email as string | null) ?? (c.email as string | null) ?? null,
            phone: (c.work_phone_number as string | null) ?? (c.phone as string | null) ?? null,
            avatarUrl: (c.profile_picture_url as string | null) ?? null,
          };
        }
      }
    }
  }

  return { categoryBuyer, preferredCertifications, buyingWindow, sourcingProvinces };
}

/**
 * Returns the logged-in member's own procurement profile — the categories they
 * carry, certification preferences, and whether they have any data at all.
 * Used to personalise the partner directory view for members.
 *
 * Uses admin client since procurement_info is not publicly readable via RLS.
 * Returns null if the user is not authenticated or has no member org.
 */
export async function getMemberOrgProfile(): Promise<MemberOrgProfile | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  // auth.ctx already has the user's active org IDs and which are org_admin.
  // Use the admin client to look up which active org is a Member type — avoids
  // a second RLS-bound user_organizations query and the role column name ambiguity.
  const allOrgIds = auth.ctx.activeOrgIds;
  if (allOrgIds.length === 0) return null;

  const { data: orgRows } = await db
    .from("organizations")
    .select("id, slug, type")
    .in("id", allOrgIds)
    .eq("type", "Member")
    .limit(1)
    .maybeSingle();

  if (!orgRows) return null;

  const memberOrgId = orgRows.id as string;
  const orgSlug = (orgRows.slug as string | null) ?? null;
  // isOrgAdmin: true if this org's ID is in the user's orgAdminOrgIds list
  const isOrgAdmin = auth.ctx.orgAdminOrgIds.includes(memberOrgId);

  // Fetch org procurement_info and primary contact in parallel
  const [orgResult, primaryContactResult] = await Promise.all([
    db
      .from("organizations")
      .select("procurement_info")
      .eq("id", memberOrgId)
      .maybeSingle(),
    db
      .from("contacts")
      .select("id, name")
      .eq("organization_id", memberOrgId)
      .eq("is_primary", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!orgResult.data) return null;

  const primaryContactId = (primaryContactResult.data?.id as string | null) ?? null;
  const primaryContactName = (primaryContactResult.data?.name as string | null) ?? null;

  const pi = orgResult.data.procurement_info as Record<string, unknown> | null;

  // No procurement_info at all → nothing has been entered
  if (!pi) {
    return { categories: [], preferredCertifications: [], hasCategoryData: false, isOrgAdmin, orgSlug, primaryContactId, primaryContactName };
  }

  const buyers = Array.isArray(pi.category_buyers) ? (pi.category_buyers as Array<Record<string, unknown>>) : [];
  const categories = buyers.map((b) => b.category as string).filter(Boolean);

  const showCerts = pi.show_certifications !== false;
  const preferredCertifications = showCerts && Array.isArray(pi.preferred_certifications)
    ? (pi.preferred_certifications as string[])
    : [];

  // hasCategoryData: specifically whether product categories are declared.
  // This is the only thing that drives partner fit scoring — having certs or
  // provinces alone doesn't help rank partners against this store.
  const hasCategoryData = categories.length > 0;

  return { categories, preferredCertifications, hasCategoryData, isOrgAdmin, orgSlug, primaryContactId, primaryContactName };
}
