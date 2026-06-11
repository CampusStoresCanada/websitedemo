import { unstable_cache } from "next/cache";
import {
  getOrganizationProfile,
  type BenchmarkingWithOrg,
} from "@/lib/data";

const getCachedOrgProfile = unstable_cache(
  (slug: string) => getOrganizationProfile(slug),
  ["org-profile"],
  { revalidate: 60, tags: ["org-profile"] }
);
import type {
  Organization,
  Contact,
  BrandColor,
  Benchmarking,
} from "@/lib/types/db";
import { loadVisibilityConfig, applyFieldMask } from "./engine";
import type { ViewerContext } from "./viewer";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const raw = await getCachedOrgProfile(slug);

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

  // -------------------------------------------------------------------------
  // Org-controlled section visibility flags
  // Admins and the org's own org_admin always see everything.
  // -------------------------------------------------------------------------
  const isPrivilegedViewer =
    isOwnOrg ||
    viewer.viewerLevel === "org_admin" ||
    viewer.viewerLevel === "admin" ||
    viewer.viewerLevel === "super_admin";

  const orgFlags = raw.organization as Organization;

  // Contacts: hide entire section if opted out and viewer isn't privileged.
  // Also filter out individually-hidden contacts for non-privileged viewers.
  const visibleContacts =
    !isPrivilegedViewer && orgFlags.show_contacts === false
      ? []
      : isPrivilegedViewer
        ? maskedContacts
        : maskedContacts.filter((c) => !c.hidden);

  // show_primary_contact and show_store_information are passed through on visibleOrg
  // and enforced by the rendering layer (MemberProfile) against viewerLevel.

  // Brand colors: hide if opted out and viewer isn't privileged
  const visibleBrandColors =
    !isPrivilegedViewer && orgFlags.show_brand_colors === false
      ? []
      : raw.brandColors;

  // Benchmarking: hide own data and filter from comparison if opted out
  let visibleBenchmarking = raw.benchmarking;
  let visibleAllBenchmarking = raw.allBenchmarking;

  if (!isPrivilegedViewer && orgFlags.show_in_benchmarking === false) {
    visibleBenchmarking = null;
  }

  if (viewer.viewerLevel !== "admin" && viewer.viewerLevel !== "super_admin") {
    // Filter opted-out orgs from the comparison set
    try {
      const adminClient = createAdminClient();
      const { data: optedOut } = await adminClient
        .from("organizations")
        .select("id")
        .eq("show_in_benchmarking", false);
      if (optedOut && optedOut.length > 0) {
        const optedOutIds = new Set(optedOut.map((o) => o.id));
        visibleAllBenchmarking = raw.allBenchmarking.filter(
          (b) => !optedOutIds.has((b.organization as { id: string }).id)
        );
      }
    } catch {
      // Non-critical — fall back to unfiltered list
    }
  }

  return {
    organization: visibleOrg,
    contacts: visibleContacts,
    brandColors: visibleBrandColors,
    benchmarking: visibleBenchmarking,
    allBenchmarking: visibleAllBenchmarking,
  };
}
