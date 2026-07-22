import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import type { HomeConferencePin } from "@/lib/homepage";
import type { ViewerContext } from "@/lib/visibility/viewer";
import { getMemberSupplierData } from "@/lib/actions/member-suppliers";
import { getPartnerMarketData } from "@/lib/actions/partner-market";
import { getActiveSponsors } from "@/lib/actions/sponsorship";

// ---------------------------------------------------------------------------
// Conference pin — moved here unchanged from lib/homepage.ts. Still private;
// only used internally by getHomeSlides().
// ---------------------------------------------------------------------------

/**
 * The nearest conference with coordinates set. Public-facing statuses are
 * visible to everyone; draft is visible only to admin/super_admin viewers
 * (same draft-preview convention the conference offers/cart pages already
 * use). One without location_latitude/location_longitude simply doesn't get
 * a pin rather than falling back to a city-level guess — a venue pin should
 * be exact or absent.
 */
async function fetchConferencePin(viewerIsAdmin: boolean): Promise<HomeConferencePin | null> {
  const visibleStatuses = viewerIsAdmin ? [...PUBLIC_CONFERENCE_STATUSES, "draft"] : PUBLIC_CONFERENCE_STATUSES;

  const db = createAdminClient();
  const { data } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code, location_venue, location_city, location_province, location_latitude, location_longitude, status, start_date")
    .in("status", visibleStatuses)
    .not("location_latitude", "is", null)
    .not("location_longitude", "is", null)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data || data.location_latitude == null || data.location_longitude == null || !data.location_venue) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    venue: data.location_venue,
    city: data.location_city,
    province: data.location_province,
    lat: data.location_latitude,
    lng: data.location_longitude,
    isDraftPreview: data.status === "draft",
    href: `/conference/${data.year}/${data.edition_code}`,
  };
}

// ---------------------------------------------------------------------------
// Newest member/partner
// ---------------------------------------------------------------------------

const NEWEST_ORG_WINDOW_DAYS = 90;

/**
 * A recently-joined org for the homepage spotlight slide. Deliberately
 * narrow: only ever populated for an org that joined within the last 90
 * days, and only from `membership_started_at` (a real join date) — never
 * `created_at` (a bulk-import timestamp shared by dozens of orgs, not a
 * real join date; falling back to it would misrepresent long-standing orgs
 * as new).
 */
export interface HomeNewestOrgSlide {
  id: string;
  slug: string;
  name: string;
  type: string;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  membershipStartedAt: string;
}

export async function fetchNewestOrgSlide(): Promise<HomeNewestOrgSlide | null> {
  const cutoff = new Date(Date.now() - NEWEST_ORG_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const db = createAdminClient();
  const { data } = await db
    .from("organizations")
    .select("id, slug, name, type, city, province, latitude, longitude, membership_started_at")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .gte("membership_started_at", cutoff)
    .order("membership_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || !data.membership_started_at) return null;

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    type: data.type,
    city: data.city ?? null,
    province: data.province ?? null,
    latitude: typeof data.latitude === "number" ? data.latitude : null,
    longitude: typeof data.longitude === "number" ? data.longitude : null,
    membershipStartedAt: data.membership_started_at,
  };
}

// ---------------------------------------------------------------------------
// Sponsor showcase
// ---------------------------------------------------------------------------

export interface HomeSponsorEntry {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationLogoUrl: string | null;
  tierName: string;
  tierColor: string | null;
}

/** All currently-active sponsors, shown together as a small showcase — not a single "top sponsor" pick (no such concept exists in the data model). */
export interface HomeSponsorSlide {
  sponsors: HomeSponsorEntry[];
}

export async function fetchSponsorSlide(): Promise<HomeSponsorSlide | null> {
  const result = await getActiveSponsors();
  if (!result.success || result.data.length === 0) return null;

  return {
    sponsors: result.data.map((s) => ({
      organizationId: s.organizationId,
      organizationName: s.organizationName,
      organizationSlug: s.organizationSlug,
      organizationLogoUrl: s.organizationLogoUrl,
      tierName: s.tier.name,
      tierColor: s.tier.color,
    })),
  };
}

// ---------------------------------------------------------------------------
// Personalization — member supplier matches / partner market matches
// ---------------------------------------------------------------------------

/**
 * A teaser for the viewer's top match, reusing the already-shipped matching
 * engines (getMemberSupplierData / getPartnerMarketData) — not a new
 * recommendation system. Carries just enough of the top match to render a
 * homepage card: this is not the full matching UI.
 */
export interface HomePersonalizedSlide {
  /** Which matching engine produced this — drives label/copy choice in the UI. */
  viewerOrgType: "member" | "partner";
  matchOrgId: string;
  matchOrgName: string;
  matchOrgSlug: string;
  /** Short reason label, e.g. the matching category. */
  matchCategory: string | null;
  totalMatches: number;
}

export async function fetchPersonalizedSlide(viewer: ViewerContext): Promise<HomePersonalizedSlide | null> {
  const isMemberViewer = viewer.viewerLevel === "member" || viewer.viewerLevel === "org_admin";
  const isPartnerViewer = viewer.viewerLevel === "partner";
  if (!isMemberViewer && !isPartnerViewer) return null;
  if (viewer.viewerOrgIds.length === 0) return null;

  // ViewerContext.viewerOrgIds isn't typed by org type, and neither
  // getMemberOrgProfile()/getPartnerOrgProfile() (lib/actions/partner-context.ts)
  // return an org id — only slug / category — so a small direct lookup is
  // needed to get the org id (and, for partners, primary_category) that
  // getMemberSupplierData/getPartnerMarketData require.
  const db = createAdminClient();
  const targetType = isMemberViewer ? "Member" : "Vendor Partner";
  const { data: orgRows } = await db
    .from("organizations")
    .select("id, primary_category")
    .in("id", viewer.viewerOrgIds)
    .eq("type", targetType)
    .limit(1);

  const org = (orgRows ?? [])[0] ?? null;
  if (!org) return null;

  if (isMemberViewer) {
    const result = await getMemberSupplierData(viewer.userEmail, org.id);
    if (!result.success || !result.data || !result.data.hasAssignments || result.data.topMatches.length === 0) {
      return null;
    }
    const top = result.data.topMatches[0];
    return {
      viewerOrgType: "member",
      matchOrgId: top.orgId,
      matchOrgName: top.orgName,
      matchOrgSlug: top.orgSlug,
      matchCategory: top.matchingCategory,
      totalMatches: result.data.totalMatches,
    };
  }

  const result = await getPartnerMarketData(org.id, org.primary_category);
  if (!result.success || !result.data || result.data.topMatches.length === 0) {
    return null;
  }
  const top = result.data.topMatches[0];
  return {
    viewerOrgType: "partner",
    matchOrgId: top.orgId,
    matchOrgName: top.orgName,
    matchOrgSlug: top.orgSlug,
    matchCategory: top.matchingCategory,
    totalMatches: result.data.totalMatches,
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface HomeSlides {
  conferencePin: HomeConferencePin | null;
  newestOrgSlide: HomeNewestOrgSlide | null;
  sponsorSlide: HomeSponsorSlide | null;
  personalizedSlide: HomePersonalizedSlide | null;
}

export async function getHomeSlides(viewer: ViewerContext, viewerIsAdmin: boolean): Promise<HomeSlides> {
  const [conferencePin, newestOrgSlide, sponsorSlide, personalizedSlide] = await Promise.all([
    fetchConferencePin(viewerIsAdmin),
    fetchNewestOrgSlide(),
    fetchSponsorSlide(),
    fetchPersonalizedSlide(viewer),
  ]);

  return { conferencePin, newestOrgSlide, sponsorSlide, personalizedSlide };
}
