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
import { viewerMaySeeCancoll, gateCancoll } from "./cancoll";
import type { ViewerContext } from "./viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveOrgPageBenchmarking,
  loadViewerBenchmarkingStanding,
  projectPeerRows,
  mayReceivePeerSet,
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

  // CANCOLL rides in the same `certifications` array as the eight self-declared
  // badges, but it is not one of them: it's a purchasing-group relationship and
  // only orgs in that relationship (either side) may see it. The eight are
  // public. Decided here, before serialisation — the array is now publicly
  // visible, so a render-time filter would still ship the string to a client
  // that has no business holding it.
  const maySeeCancoll = viewerMaySeeCancoll(viewer, isOwnOrg);
  if (Array.isArray(visibleOrg.certifications)) {
    visibleOrg.certifications = gateCancoll(
      visibleOrg.certifications as string[],
      maySeeCancoll
    );
  }

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

  let benchmarkingWithheldReason: string | null = null;

  /*
    The peer set is gated and projected UNCONDITIONALLY, before anything else
    touches it. Both of those used to happen inside `if (visibleBenchmarking)`,
    which is a different question — it asks whether THIS page's store has a
    visible row, not what the VIEWER is entitled to. A store that had switched
    show_in_benchmarking off nulled that variable and skipped the projection
    entirely, handing out whole unprojected rows for everyone else.

    This path reads with the service role, so RLS is not a backstop and an
    ungated peer set is a financial disclosure.
  */
  const viewerInExchange = mayReceivePeerSet(
    viewer.viewerLevel,
    viewer.viewerOrgIds ?? [],
    viewer.viewerIsMemberStore === true,
  );

  const standing = viewerInExchange
    ? await loadViewerBenchmarkingStanding(viewer.viewerOrgIds ?? [])
    : { filed: false, disclosureLevel: null as string | null };

  const decision = resolveOrgPageBenchmarking({
    targetDisclosureLevel: (visibleBenchmarking as { disclosure_level?: string | null } | null)
      ?.disclosure_level,
    viewerFiled: standing.filed,
    viewerDisclosureLevel: standing.disclosureLevel,
    isOwnOrg: (viewer.viewerOrgIds ?? []).includes(targetOrgId),
    isStaff: isStaffViewer,
  });

  if (!viewerInExchange || decision.show === "none") {
    // Nothing. A non-participant does not receive the group's figures, and
    // neither does an account outside the exchange.
    visibleAllBenchmarking = [];
    visibleBenchmarking = null;
    if (viewerInExchange && decision.show === "none") {
      benchmarkingWithheldReason = decision.reason;
    }
  } else {
    if (decision.show === "aggregate") {
      visibleBenchmarking = null;
      benchmarkingWithheldReason = decision.reason;
    }

    // Only the fields that render, and names only for a viewer entitled to them.
    visibleAllBenchmarking = projectPeerRows(
      visibleAllBenchmarking as unknown as Parameters<typeof projectPeerRows>[0],
      {
        nameThem: decision.show === "detail",
        viewerOrgIds: viewer.viewerOrgIds ?? [],
      },
    ) as unknown as typeof visibleAllBenchmarking;

    /*
      Stores that asked to be left out of the comparison entirely.

      ⚠️ This filtered `raw.allBenchmarking` — the ungated, unprojected source —
      and reassigned it over everything above. One org has the flag set, so the
      branch was live for every non-admin viewer, and it put 39 named stores'
      complete benchmarking rows into the payload of a logged-out page. Filter
      the PROJECTED array, by organization_id, because a projected row's
      `organization` is null whenever the viewer may not see the name.
    */
    if (!isStaffViewer) {
      try {
        const adminClient = createAdminClient();
        const { data: optedOut } = await adminClient
          .from("organizations")
          .select("id")
          .eq("show_in_benchmarking", false);
        if (optedOut && optedOut.length > 0) {
          const optedOutIds = new Set(optedOut.map((o) => o.id));
          visibleAllBenchmarking = (
            visibleAllBenchmarking as unknown as { organization_id: string }[]
          ).filter(
            (b) => !optedOutIds.has(b.organization_id),
          ) as unknown as typeof visibleAllBenchmarking;
        }
      } catch {
        // Withhold rather than fall back to an unfiltered list: the previous
        // comment called this non-critical, and it is the opposite.
        visibleAllBenchmarking = [];
      }
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
