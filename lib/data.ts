import { supabase } from "./supabase";
import type { Organization, Contact, BrandColor, Benchmarking } from "./database.types";

// Fetch all active organizations (members and partners)
export async function getOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .is("archived_at", null)
    .order("name");

  if (error) {
    console.error("Error fetching organizations:", error);
    return [];
  }

  return data || [];
}

// Fetch organizations by type
export async function getOrganizationsByType(
  type: "Member" | "Vendor Partner"
): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("type", type)
    .is("archived_at", null)
    .order("name");

  if (error) {
    console.error(`Error fetching ${type}s:`, error);
    return [];
  }

  return data || [];
}

// Fetch active members only
export async function getMembers(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .order("name");

  if (error) {
    console.error("Error fetching members:", error);
    return [];
  }

  return data || [];
}

// Fetch vendor partners only
export async function getPartners(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("type", "Vendor Partner")
    .is("archived_at", null)
    .order("name");

  if (error) {
    console.error("Error fetching partners:", error);
    return [];
  }

  return data || [];
}

// Fetch single organization by slug
export async function getOrganizationBySlug(
  slug: string
): Promise<Organization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .is("archived_at", null)
    .single();

  if (error) {
    console.error(`Error fetching organization ${slug}:`, error);
    return null;
  }

  return data;
}

// Fetch contacts for an organization
export async function getContactsForOrganization(
  organizationId: string
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("name");

  if (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }

  return data || [];
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
  const { data, error } = await supabase
    .from("brand_colors")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order");

  if (error) {
    console.error("Error fetching brand colors:", error);
    return [];
  }

  return data || [];
}

// Fetch latest benchmarking data for an organization
export async function getLatestBenchmarking(
  organizationId: string
): Promise<Benchmarking | null> {
  const { data, error } = await supabase
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organizationId)
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows found, which is fine
    if (error.code !== "PGRST116") {
      console.error("Error fetching benchmarking:", error);
    }
    return null;
  }

  return data;
}

// Fetch organization with all related data for profile page
export async function getOrganizationProfile(slug: string): Promise<{
  organization: Organization | null;
  contacts: Contact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
}> {
  const organization = await getOrganizationBySlug(slug);

  if (!organization || !organization.id) {
    return { organization: null, contacts: [], brandColors: [], benchmarking: null };
  }

  // Fetch all related data in parallel
  const [contacts, brandColors, benchmarking] = await Promise.all([
    getContactsForOrganization(organization.id),
    getBrandColorsForOrganization(organization.id),
    getLatestBenchmarking(organization.id),
  ]);

  return { organization, contacts, brandColors, benchmarking };
}

// Get counts for stats
export async function getStats(): Promise<{
  memberCount: number;
  partnerCount: number;
  provinceCount: number;
}> {
  // Get member count
  const { count: memberCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null);

  // Get partner count
  const { count: partnerCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("type", "Vendor Partner")
    .is("archived_at", null);

  // Get unique provinces
  const { data: provinces } = await supabase
    .from("organizations")
    .select("province")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .not("province", "is", null);

  const uniqueProvinces = new Set(
    (provinces as { province: string | null }[] | null)?.map((p) => p.province)
  );

  return {
    memberCount: memberCount || 0,
    partnerCount: partnerCount || 0,
    provinceCount: uniqueProvinces.size,
  };
}
