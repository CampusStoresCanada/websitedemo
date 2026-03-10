import { supabase } from "./supabase";
import type { Organization, Contact, BrandColor, Benchmarking, SiteContent } from "./database.types";
import { createAdminClient } from "@/lib/supabase/admin";

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
      .eq("membership_status", "active")
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

// Get counts for stats
export async function getStats(): Promise<{
  memberCount: number;
  partnerCount: number;
  provinceCount: number;
}> {
  // Run all queries in parallel with timeouts
  const [memberResult, partnerResult, provincesResult] = await Promise.all([
    withTimeout(
      supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Member")
        .eq("membership_status", "active")
        .is("archived_at", null),
      DB_TIMEOUT,
      { count: 0, error: null }
    ),
    withTimeout(
      supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Vendor Partner")
        .is("archived_at", null),
      DB_TIMEOUT,
      { count: 0, error: null }
    ),
    withTimeout(
      supabase
        .from("organizations")
        .select("province")
        .eq("type", "Member")
        .eq("membership_status", "active")
        .is("archived_at", null)
        .not("province", "is", null),
      DB_TIMEOUT,
      { data: null, error: null }
    ),
  ]);

  const uniqueProvinces = new Set(
    (provincesResult.data as { province: string | null }[] | null)?.map((p) => p.province)
  );

  return {
    memberCount: memberResult.count || 0,
    partnerCount: partnerResult.count || 0,
    provinceCount: uniqueProvinces.size,
  };
}

// ─────────────────────────────────────────────────────────────────
// Directory queries — projection-only (no private fields leave DB)
// ─────────────────────────────────────────────────────────────────

/** Public-safe columns for directory listings. Never includes contacts, emails, phones, etc. */
const DIRECTORY_SELECT =
  "id, slug, name, type, membership_status, logo_url, logo_horizontal_url, city, province, country, primary_category, company_description, website" as const;

/** Active members for public directory. Status matches isOrgPubliclyListable(). */
export async function getDirectoryMembers(): Promise<Partial<Organization>[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select(DIRECTORY_SELECT)
      .eq("type", "Member")
      .in("membership_status", ["active", "reactivated"])
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

/** Partners for public directory. All non-archived partners shown. */
export async function getDirectoryPartners(): Promise<Partial<Organization>[]> {
  const result = await withTimeout(
    supabase
      .from("organizations")
      .select(DIRECTORY_SELECT)
      .eq("type", "Vendor Partner")
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

/** Fetch active site content entries for a given section, ordered by display_order. */
export async function getSiteContent(section: string): Promise<SiteContent[]> {
  // Prefer trusted server-side read (service role) so public rendering does not depend on anon RLS policy.
  try {
    const adminClient = createAdminClient();
    const adminResult = await withTimeout(
      adminClient
        .from("site_content")
        .select("*")
        .eq("section", section)
        .or("is_active.eq.true,is_active.is.null")
        .order("display_order"),
      DB_TIMEOUT,
      { data: null, error: TIMEOUT_ERROR }
    );

    if (!adminResult.error) {
      return (adminResult.data || []) as SiteContent[];
    }
  } catch {
    // Service role may be unavailable in some local setups; fallback to anon client below.
  }

  const anonResult = await withTimeout(
    supabase
      .from("site_content")
      .select("*")
      .eq("section", section)
      .or("is_active.eq.true,is_active.is.null")
      .order("display_order"),
    DB_TIMEOUT,
    { data: null, error: TIMEOUT_ERROR }
  );

  if (!anonResult.error) {
    return (anonResult.data || []) as SiteContent[];
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
