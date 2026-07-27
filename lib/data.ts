import { supabase } from "./supabase";
import type { Organization, Contact, BrandColor, Benchmarking, SiteContent } from "./types/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_LISTABLE_ORG_STATUSES, ORG_PROFILE_RESOLVABLE_STATUSES } from "@/lib/membership/status";

/** Org data embedded in a board card contact join. */
export type OrgForCard = Pick<Organization, "id" | "slug" | "logo_url" | "type" | "membership_status" | "archived_at"> & {
  brand_colors: Pick<BrandColor, "hex" | "sort_order">[];
};

/** Contact data embedded in a site_content slot join. */
export type ContactForCard = Pick<Contact, "id" | "name" | "profile_picture_url" | "role_title" | "circle_id"> & {
  organization: OrgForCard | null;
};

/** site_content row with the linked contact record (and its org + brand colours) if any. */
export type SiteContentWithContact = SiteContent & {
  contact: ContactForCard | null;
};

// Timeout fallback that works with PostgrestResponse types
const TIMEOUT_ERROR = { message: "timeout", details: "", hint: "", code: "TIMEOUT", name: "TimeoutError" } as const;

// Helper to add timeout to DB queries - prevents page hangs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, fallback: any): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const DB_TIMEOUT = 5000; // 5 seconds

// Fetch all active organizations (members and partners)
export async function getOrganizations(): Promise<Organization[]> {
  const query = supabase
    .from("organizations")
    .select("*")
    .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
    .is("archived_at", null)
    .order("name");

  const result = await withTimeout(
    query,
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching organizations:", result.error);
    return [];
  }

  return result.data || [];
}

// Fetch organizations by type
export async function getOrganizationsByType(
  type: "Member" | "Vendor Partner"
): Promise<Organization[]> {
  const query = supabase
    .from("organizations")
    .select("*")
    .eq("type", type)
    .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
    .is("archived_at", null)
    .order("name");

  const result = await withTimeout(
    query,
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error(`Error fetching ${type}s:`, result.error);
    return [];
  }

  return result.data || [];
}

// Fetch active members only
export async function getMembers(): Promise<Organization[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select("*")
      .eq("type", "Member")
      .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
      .is("archived_at", null)
      .order("name"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching members:", result.error);
    return [];
  }

  return result.data || [];
}

// Fetch vendor partners only
export async function getPartners(): Promise<Organization[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select("*")
      .eq("type", "Vendor Partner")
      .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
      .is("archived_at", null)
      .order("name"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching partners:", result.error);
    return [];
  }

  return result.data || [];
}

// Fetch single organization by slug
export async function getOrganizationBySlug(
  slug: string
): Promise<Organization | null> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select("*")
      .eq("slug", slug)
      .in("membership_status", ORG_PROFILE_RESOLVABLE_STATUSES)
      .is("archived_at", null)
      .single(),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error(`Error fetching organization ${slug}:`, result.error);
    return null;
  }

  return result.data;
}

// Fetch contacts for an organization
export async function getContactsForOrganization(
  organizationId: string
): Promise<Contact[]> {
  const result = await withTimeout(
    supabase
      .from("contacts")
      .select("*")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("name"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching contacts:", result.error);
    return [];
  }

  return result.data || [];
}

// Fetch organization with contacts
export async function getOrganizationWithContacts(slug: string): Promise<{
  organization: Organization | null;
  contacts: Contact[];
}> {
  const organization = await getOrganizationBySlug(slug);

  if (!organization || !organization.id) {
    return { organization: null, contacts: [] };
  }

  const contacts = await getContactsForOrganization(organization.id);

  return { organization, contacts };
}

// Fetch brand colors for an organization
export async function getBrandColorsForOrganization(
  organizationId: string
): Promise<BrandColor[]> {
  const result = await withTimeout(
    supabase
      .from("brand_colors")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching brand colors:", result.error);
    return [];
  }

  return result.data || [];
}

// Fetch latest benchmarking data for an organization
export async function getLatestBenchmarking(
  organizationId: string
): Promise<Benchmarking | null> {
  const result = await withTimeout(
    supabase
      .from("benchmarking")
      .select("*")
      .eq("organization_id", organizationId)
      .order("fiscal_year", { ascending: false })
      .limit(1)
      .single(),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    // PGRST116 = no rows found, which is expected
    // Empty error object = RLS permission denied (also expected for anon users)
    // "timeout" = our timeout wrapper
    if (result.error.code && result.error.code !== "PGRST116" && result.error.message !== "timeout") {
      console.error("Error fetching benchmarking:", result.error);
    }
    return null;
  }

  return result.data;
}

// Fetch all benchmarking data with organization info for comparison table
export type BenchmarkingWithOrg = Benchmarking & {
  organization: Pick<Organization, 'id' | 'name' | 'slug'>;
};

export async function getAllBenchmarking(): Promise<BenchmarkingWithOrg[]> {
  const result = await withTimeout(
    supabase
      .from("benchmarking")
      .select(`
        *,
        organization:organizations!benchmarking_organization_id_fkey (
          id,
          name,
          slug
        )
      `)
      .order("fiscal_year", { ascending: false }),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching all benchmarking:", result.error);
    return [];
  }

  return (result.data || []) as BenchmarkingWithOrg[];
}

// Fetch organization with all related data for profile page
export async function getOrganizationProfile(slug: string): Promise<{
  organization: Organization | null;
  contacts: Contact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
  allBenchmarking: BenchmarkingWithOrg[];
}> {
  const organization = await getOrganizationBySlug(slug);

  if (!organization || !organization.id) {
    return { organization: null, contacts: [], brandColors: [], benchmarking: null, allBenchmarking: [] };
  }

  // Fetch all related data in parallel
  const [contacts, brandColors, benchmarking, allBenchmarking] = await Promise.all([
    getContactsForOrganization(organization.id),
    getBrandColorsForOrganization(organization.id),
    getLatestBenchmarking(organization.id),
    getAllBenchmarking(),
  ]);

  return { organization, contacts, brandColors, benchmarking, allBenchmarking };
}

// ─────────────────────────────────────────────────────────────────
// FTE stats helper — exact benchmarking + bucket-floor fallback
// ─────────────────────────────────────────────────────────────────

/**
 * Computes total FTE served across active members.
 *
 * Strategy:
 *   1. Members with benchmarking.enrollment_fte → exact value.
 *   2. Members without benchmarking but with a computed membership_assessment
 *      → use the assessment's metric_value (the FTE submitted for billing).
 *   3. Members with no data at all → use the smallest known benchmarking
 *      enrollment_fte as a conservative floor (i.e. at least one Royal Roads).
 *
 * Returns the total and a flag indicating whether estimates were used
 * (so the UI can append "+" to the display).
 */
async function computeFteStats(): Promise<{ total: number; hasEstimates: boolean }> {
  const adminClient = createAdminClient();

  // 1. All active member IDs
  const memberOrgsResult = await withTimeout(
    adminClient
      .from("organizations")
      .select("id")
      .eq("type", "Member")
      .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
      .is("archived_at", null),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  const allMemberIds = ((memberOrgsResult.data ?? []) as { id: string }[]).map((o) => o.id);
  if (!allMemberIds.length) return { total: 0, hasEstimates: false };

  // 2. Benchmarking FTE + organizations.fte + assessment metric_values (parallel)
  const [benchmarkingResult, orgFteResult, assessmentResult] = await Promise.all([
    withTimeout(
      adminClient
        .from("benchmarking")
        .select("organization_id, enrollment_fte, fiscal_year")
        .in("organization_id", allMemberIds)
        .not("enrollment_fte", "is", null)
        .order("fiscal_year", { ascending: false }),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    ),
    withTimeout(
      adminClient
        .from("organizations")
        .select("id, fte")
        .in("id", allMemberIds)
        .not("fte", "is", null),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    ),
    withTimeout(
      adminClient
        .from("membership_assessments")
        .select("organization_id, metric_value, metric_key, billing_cycle_year")
        .in("organization_id", allMemberIds)
        .eq("assessment_status", "computed")
        .not("metric_value", "is", null)
        .order("billing_cycle_year", { ascending: false }),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    ),
  ]);

  // Direct organizations.fte values (populated from Notion sync)
  const orgFteMap = new Map<string, number>();
  for (const row of ((orgFteResult.data ?? []) as { id: string; fte: number }[])) {
    if (row.fte > 0) orgFteMap.set(row.id, row.fte);
  }

  // Latest benchmarking per org (rows ordered fiscal_year desc → first = latest)
  const benchmarkedOrgs = new Map<string, number>();
  for (const row of ((benchmarkingResult.data ?? []) as { organization_id: string; enrollment_fte: number }[])) {
    if (!benchmarkedOrgs.has(row.organization_id)) {
      benchmarkedOrgs.set(row.organization_id, row.enrollment_fte);
    }
  }

  // Latest assessment metric_value per org — prefer enrollment_fte key, accept any
  const assessedOrgs = new Map<string, number>();
  // First pass: enrollment-based metric keys
  for (const row of ((assessmentResult.data ?? []) as { organization_id: string; metric_value: number; metric_key: string }[])) {
    if (assessedOrgs.has(row.organization_id)) continue;
    if (row.metric_key?.includes("enrollment_fte")) {
      assessedOrgs.set(row.organization_id, row.metric_value);
    }
  }
  // Second pass: any computed metric_value for orgs still missing
  for (const row of ((assessmentResult.data ?? []) as { organization_id: string; metric_value: number; metric_key: string }[])) {
    if (!assessedOrgs.has(row.organization_id) && row.metric_value != null) {
      assessedOrgs.set(row.organization_id, row.metric_value);
    }
  }

  // Conservative floor: smallest known enrollment_fte across all benchmarked members
  const knownFteValues = Array.from(benchmarkedOrgs.values());
  const conservativeFloor = knownFteValues.length > 0
    ? Math.min(...knownFteValues)
    : 90; // Royal Roads approximation if no benchmarking data at all

  // 3. Sum: exact benchmarking first, then org FTE, then assessment, then floor
  //    Priority: benchmarking.enrollment_fte > organizations.fte (Notion) > assessment metric_value > conservative floor
  let total = 0;
  for (const fte of benchmarkedOrgs.values()) {
    total += fte;
  }
  const unbenchmarkedIds = allMemberIds.filter((id) => !benchmarkedOrgs.has(id));
  for (const id of unbenchmarkedIds) {
    const orgFte = orgFteMap.get(id);
    const assessedFte = assessedOrgs.get(id);
    total += orgFte ?? assessedFte ?? conservativeFloor;
  }

  return { total, hasEstimates: unbenchmarkedIds.length > 0 };
}

// Get counts for stats
export async function getStats(): Promise<{
  memberCount: number;
  partnerCount: number;
  provinceCount: number;
  totalFteServed: number;
  fteIsEstimate: boolean;
}> {
  // Member/partner counts and province list run in parallel with FTE computation
  const [memberResult, partnerResult, provincesResult, fteData] = await Promise.all([
    withTimeout(
      supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Member")
        .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
        .is("archived_at", null),
      DB_TIMEOUT,
      { count: 0, error: null }
    ),
    withTimeout(
      supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Vendor Partner")
        .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
        .is("archived_at", null),
      DB_TIMEOUT,
      { count: 0, error: null }
    ),
    withTimeout(
      supabase
        .from("organizations")
        .select("province")
        .eq("type", "Member")
        .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
        .is("archived_at", null)
        .not("province", "is", null),
      DB_TIMEOUT,
      { data: null, error: null }
    ),
    computeFteStats().catch(() => ({ total: 0, hasEstimates: false })),
  ]);

  const uniqueProvinces = new Set(
    (provincesResult.data as { province: string | null }[] | null)?.map((p) => p.province)
  );

  return {
    memberCount: memberResult.count || 0,
    partnerCount: partnerResult.count || 0,
    provinceCount: uniqueProvinces.size,
    totalFteServed: fteData.total,
    fteIsEstimate: fteData.hasEstimates,
  };
}

// ─────────────────────────────────────────────────────────────────
// Directory queries — projection-only (no private fields leave DB)
// ─────────────────────────────────────────────────────────────────

/** Public-safe columns for directory listings. Never includes contacts, emails, phones, etc. */
const DIRECTORY_SELECT =
  "id, slug, name, type, membership_status, logo_url, logo_horizontal_url, city, province, country, primary_category, company_description, website" as const;

/** Active members for public directory. */
export async function getDirectoryMembers(): Promise<Partial<Organization>[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select(DIRECTORY_SELECT)
      .eq("type", "Member")
      .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
      .is("archived_at", null)
      .order("name"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching directory members:", result.error);
    return [];
  }

  return (result.data || []) as Partial<Organization>[];
}

/** Active partners for public directory. */
export async function getDirectoryPartners(): Promise<Partial<Organization>[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select(DIRECTORY_SELECT)
      .eq("type", "Vendor Partner")
      .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
      .is("archived_at", null)
      .order("name"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (result.error) {
    console.error("Error fetching directory partners:", result.error);
    return [];
  }

  return (result.data || []) as Partial<Organization>[];
}

// ─────────────────────────────────────────────────────────────────
// Site content (admin-editable: board, staff, etc.)
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// CSC staff — live contact query
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch all non-archived contacts from the Campus Stores Canada organization
 * whose contact_type includes "Staff", ordered by name.
 *
 * Uses the admin client so it works server-side without depending on RLS.
 */
export async function getCSCStaff(): Promise<Contact[]> {
  try {
    const adminClient = createAdminClient();

    // Look up the CSC org by slug — avoids hardcoding a UUID.
    const orgResult = await withTimeout(
      adminClient
        .from("organizations")
        .select("id")
        .eq("slug", "campus-stores-canada")
        .single(),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    );

    if (orgResult.error || !orgResult.data?.id) {
      console.error("getCSCStaff: could not resolve CSC organization", orgResult.error);
      return [];
    }

    const staffResult = await withTimeout(
      adminClient
        .from("contacts")
        .select("*")
        .eq("organization_id", orgResult.data.id)
        .contains("contact_type", ["Staff"])
        .is("archived_at", null)
        .order("name"),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    );

    if (staffResult.error) {
      console.error("getCSCStaff: error fetching staff contacts", staffResult.error);
      return [];
    }

    return (staffResult.data || []) as Contact[];
  } catch (err) {
    console.error("getCSCStaff: unexpected error", err);
    return [];
  }
}

/** Fetch active site content entries for a given section, ordered by display_order.
 *  Joins the linked contact record (name, profile_picture_url, role_title) when contact_id is set. */
export async function getSiteContent(section: string): Promise<SiteContentWithContact[]> {
  const CONTACT_JOIN = `*, contact:contacts!site_content_contact_id_fkey(
    id, name, profile_picture_url, role_title, circle_id,
    organization:organizations!contacts_organization_id_fkey(id, slug, logo_url, type, membership_status, archived_at, brand_colors(hex, sort_order))
  )`;

  // Prefer trusted server-side read (service role) so public rendering does not depend on anon RLS policy.
  try {
    const adminClient = createAdminClient();
    const adminResult = await withTimeout(
      adminClient
        .from("site_content")
        .select(CONTACT_JOIN)
        .eq("section", section)
        .or("is_active.eq.true,is_active.is.null")
        .order("display_order"),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    );

    if (!adminResult.error) {
      return (adminResult.data || []) as unknown as SiteContentWithContact[];
    }
    // Log the admin client error so it's visible — don't swallow it silently
    console.warn(
      `[getSiteContent] Admin client failed for "${section}" (code: ${adminResult.error.code}): ${adminResult.error.message}. Falling back to anon client.`
    );
  } catch (err) {
    // Service role may be unavailable in some local setups; fallback to anon client below.
    console.warn(`[getSiteContent] Admin client threw for "${section}":`, err);
  }

  const anonResult = await withTimeout(
    supabase
      .from("site_content")
      .select(CONTACT_JOIN)
      .eq("section", section)
      .or("is_active.eq.true,is_active.is.null")
      .order("display_order"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (!anonResult.error) {
    return (anonResult.data || []) as unknown as SiteContentWithContact[];
  }

  const errorCode = typeof anonResult.error.code === "string" ? anonResult.error.code : "";
  if (errorCode === "42P01") {
    console.error(
      `Error fetching site content (${section}): missing table 'public.site_content'. Apply latest Supabase migrations.`
    );
    return [];
  }
  if (errorCode === "42501") {
    console.error(
      `Error fetching site content (${section}): read denied by RLS and no service-role fallback succeeded.`
    );
    return [];
  }
  if (errorCode === "TIMEOUT") {
    console.error(
      `Error fetching site content (${section}): query timed out after ${DB_TIMEOUT}ms.`
    );
    return [];
  }

  console.error(`Error fetching site content (${section}):`, anonResult.error);
  return [];
}
