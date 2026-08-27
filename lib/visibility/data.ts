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
import {
  resolveOrgPageBenchmarking,
  loadViewerBenchmarkingStanding,
  projectPeerRows,
} from "@/lib/benchmarking/org-page-visibility";
import { isOrgAccessActive } from "@/lib/membership/status";
import type { OrgMembershipStatus } from "@/lib/membership/types";

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
  /** Set when detail is withheld, so the page can say why instead of going blank. */
  benchmarkingWithheldReason?: string | null;
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
 *
 * Benchmarking is decided HERE, not passed through. It used to be sent to
 * every viewer and gated in the browser by GreyBlur, which meant a member who
 * had never filed still received another store's net profit in the page
 * payload. See lib/benchmarking/org-page-visibility.ts for the three rules.
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
      benchmarkingWithheldReason: null,
    };
  }

  const config = await loadVisibilityConfig();
  const targetOrgId = raw.organization.id;
  const targetOrgType = raw.organization.type;

  // Whether the TARGET org's own membership/partnership is currently active
  // (active/grace/reactivated). A lapsed org (locked/canceled) shows exactly
  // what a public visitor sees — including to its own admin — until it
  // reactivates; the reminder card/banner is the explicit path to fix that,
  // not a silent unmasking bypass here.
  const orgAccessActive = isOrgAccessActive(
    (raw.organization.membership_status as OrgMembershipStatus | null) ?? null
  );
  const isStaffViewer = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";

  // org_admin viewing their own org sees everything — but only while that
  // org's own access is active.
  const isOwnOrg = viewer.viewerOrgAdminIds.includes(targetOrgId) && orgAccessActive;

  // CSC staff still see the real (unmasked-by-status) view regardless, so
  // they can act on a lapsed org (billing, support). Everyone else — public
  // visitors and the lapsed org's own people alike — sees public-tier
  // masking once the org's access isn't active.
  const maskingViewerLevel =
    !orgAccessActive && !isStaffViewer ? "public" : viewer.viewerLevel;

  // Mask organization fields
  const maskedOrg = applyFieldMask(
    raw.organization as unknown as Record<string, unknown>,
    maskingViewerLevel,
    config,
    "organizations",
    isOwnOrg,
    targetOrgType
  );

  // Always ensure essential fields are present. id/slug/name/type are
  // "in public_allowlist" by convention but forced through regardless in
  // case that admin-editable policy value ever drifts. membership_status/
  // membership_expires_at/grace_period_started_at are forced through for a
  // different reason: they're structural status fields the renewal UI
  // (banner, reactivation card, isOrgAccessActive checks) depends on to
  // function at all — not sensitive content, so they shouldn't be at the
  // mercy of the same content-visibility policy that masks contact PII.
  const visibleOrg: VisibleOrganization = {
    ...(maskedOrg as Partial<Organization>),
    id: raw.organization.id,
    slug: raw.organization.slug,
    name: raw.organization.name,
    type: raw.organization.type,
    membership_status: raw.organization.membership_status,
    membership_expires_at: raw.organization.membership_expires_at,
    grace_period_started_at: raw.organization.grace_period_started_at,
  };

  // Mask each contact
  const maskedContacts: VisibleContact[] = raw.contacts.map((contact) => {
    const masked = applyFieldMask(
      contact as unknown as Record<string, unknown>,
      maskingViewerLevel,
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

  // Reciprocity and disclosure, decided before anything is serialised. The
  // aggregate set (allBenchmarking) is deliberately still returned when detail
  // is withheld: the point is that a store counts toward the middle either way,
  // so the comparison should remain readable.
  let benchmarkingWithheldReason: string | null = null;
  if (visibleBenchmarking) {
    const standing = await loadViewerBenchmarkingStanding(viewer.viewerOrgIds ?? []);
    const decision = resolveOrgPageBenchmarking({
      targetDisclosureLevel: (visibleBenchmarking as { disclosure_level?: string | null })
        .disclosure_level,
      viewerFiled: standing.filed,
      viewerDisclosureLevel: standing.disclosureLevel,
      isOwnOrg: (viewer.viewerOrgIds ?? []).includes(targetOrgId),
      isStaff: isStaffViewer,
    });
    if (decision.show === "aggregate") {
      visibleBenchmarking = null;
      benchmarkingWithheldReason = decision.reason;
    }

    // The peer table is a NAMED league table of every store, not an aggregate,
    // and it was shipping whole benchmarking rows for all of them. Project it
    // under the same rules: only the fields that render, and names only for a
    // viewer entitled to them.
    visibleAllBenchmarking = projectPeerRows(
      visibleAllBenchmarking as unknown as Parameters<typeof projectPeerRows>[0],
      {
        nameThem: decision.show === "detail",
        viewerOrgIds: viewer.viewerOrgIds ?? [],
      },
    ) as unknown as typeof visibleAllBenchmarking;
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
    benchmarkingWithheldReason,
  };
}
