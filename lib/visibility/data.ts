import {
  getOrganizationProfile,
  type BenchmarkingWithOrg,
} from "@/lib/data";
import type {
  Organization,
  Contact,
  BrandColor,
  Benchmarking,
} from "@/lib/database.types";
import { loadVisibilityConfig, applyFieldMask } from "./engine";
import type { ViewerContext } from "./viewer";

// ---------------------------------------------------------------------------
// Return types with potentially-masked fields
// ---------------------------------------------------------------------------

/** Organization with some fields possibly nulled/masked for unauthorized viewers */
export type VisibleOrganization = Partial<Organization> & {
  id: string;
  slug: string;
  name: string;
  type: string;
};

/** Contact with some fields possibly nulled/masked for unauthorized viewers */
export type VisibleContact = Partial<Contact> & {
  id: string;
};

export interface VisibleOrganizationProfile {
  organization: VisibleOrganization | null;
  contacts: VisibleContact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
  allBenchmarking: BenchmarkingWithOrg[];
}

// ---------------------------------------------------------------------------
// Main visibility-aware data fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch an organization profile with field-level masking applied based on
 * the viewer's permission level. Private fields are either:
 * - Left intact (authorized viewer)
 * - Replaced with a masked teaser string (e.g., initials, domain)
 * - Set to null (fully hidden)
 *
 * Brand colors are always fully visible.
 * Benchmarking is passed through (has its own gating via GreyBlur/survey_participant).
 */
export async function getOrganizationForViewer(
  slug: string,
  viewer: ViewerContext
): Promise<VisibleOrganizationProfile> {
  // Fetch all raw data (unchanged from current behavior)
  const raw = await getOrganizationProfile(slug);

  if (!raw.organization) {
    return {
      organization: null,
      contacts: [],
      brandColors: [],
      benchmarking: null,
      allBenchmarking: [],
    };
  }

  const config = await loadVisibilityConfig();
  const targetOrgId = raw.organization.id;
  const targetOrgType = raw.organization.type;

  // org_admin viewing their own org sees everything
  const isOwnOrg = viewer.viewerOrgAdminIds.includes(targetOrgId);

  // Mask organization fields
  const maskedOrg = applyFieldMask(
    raw.organization as unknown as Record<string, unknown>,
    viewer.viewerLevel,
    config,
    "organizations",
    isOwnOrg,
    targetOrgType
  );

  // Always ensure essential fields are present (they're in public_allowlist)
  const visibleOrg: VisibleOrganization = {
    ...(maskedOrg as Partial<Organization>),
    id: raw.organization.id,
    slug: raw.organization.slug,
    name: raw.organization.name,
    type: raw.organization.type,
  };

  // Mask each contact
  const maskedContacts: VisibleContact[] = raw.contacts.map((contact) => {
    const masked = applyFieldMask(
      contact as unknown as Record<string, unknown>,
      viewer.viewerLevel,
      config,
      "contacts",
      isOwnOrg,
      targetOrgType
    );
    return {
      ...(masked as Partial<Contact>),
      id: contact.id,
    };
  });

  return {
    organization: visibleOrg,
    contacts: maskedContacts,
    brandColors: raw.brandColors,
    benchmarking: raw.benchmarking,
    allBenchmarking: raw.allBenchmarking,
  };
}
