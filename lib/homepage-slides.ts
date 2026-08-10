import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import type { HomeConferencePin } from "@/lib/homepage";
import type { ViewerContext } from "@/lib/visibility/viewer";
import { getMemberSupplierData } from "@/lib/actions/member-suppliers";
import { getPartnerMarketData } from "@/lib/actions/partner-market";
import { getActiveSponsors } from "@/lib/actions/sponsorship";

// ---------------------------------------------------------------------------
// Conference pin — moved here unchanged from lib/homepage.ts. Still private;
// only used internally by getHomeSlides().
// ---------------------------------------------------------------------------

/** Format cents as a whole-dollar CAD price for CTA copy — "$4,000", "$199". */
export function formatCtaPrice(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

/**
 * "Feb 1–4, 2027" (same month), "Jan 30 – Feb 2, 2027" (different months), or
 * "Dec 30, 2026 – Jan 2, 2027" (different years) from two `date`-typed
 * columns. Parsed/formatted in UTC since these are date-only values with no
 * time-of-day or timezone component — treating them as local time would risk
 * shifting the displayed day.
 */
function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear !== endYear) {
    return `${start.toLocaleDateString("en-CA", { ...opts, year: "numeric" })} – ${end.toLocaleDateString("en-CA", { ...opts, year: "numeric" })}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${start.toLocaleDateString("en-CA", opts)} – ${end.toLocaleDateString("en-CA", opts)}, ${endYear}`;
  }
  return `${start.toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" })} ${start.getUTCDate()}–${end.getUTCDate()}, ${endYear}`;
}

/**
 * Cheapest real, currently-for-sale booth (partner price) and cheapest
 * real, currently-for-sale MEMBER-audience registration excluding $0 items
 * like the Manager & Director Summit (member price) for one conference.
 * Registration audience is resolved via the real `who` entity-ref graph
 * (conference_entity_refs), not name-matching on the offer's title — an
 * "Exhibitor Staff Registration" is real member-priced data but the wrong
 * audience, and matching on the word "Exhibitor" would be fragile.
 */
export async function fetchConferenceStartingPrices(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string
): Promise<{ boothCents: number | null; memberRegistrationCents: number | null }> {
  const [{ data: boothRows }, { data: memberRegRows }] = await Promise.all([
    db
      .from("conference_entities")
      .select("price_cents")
      .eq("conference_id", conferenceId)
      .eq("kind", "booth")
      .eq("is_for_sale", true)
      .not("price_cents", "is", null)
      .order("price_cents", { ascending: true })
      .limit(1),
    db
      .from("conference_entity_refs")
      .select("from_entity:conference_entities!conference_entity_refs_from_entity_id_fkey(price_cents, is_for_sale), to_entity:conference_entities!conference_entity_refs_to_entity_id_fkey(attributes)")
      .eq("conference_id", conferenceId)
      .eq("role", "who"),
  ]);

  const boothCents = boothRows?.[0]?.price_cents ?? null;

  const memberPrices = (memberRegRows ?? [])
    .map((r) => {
      const from = Array.isArray(r.from_entity) ? r.from_entity[0] : r.from_entity;
      const to = Array.isArray(r.to_entity) ? r.to_entity[0] : r.to_entity;
      const audienceRole = (to?.attributes as Record<string, unknown> | null)?.["source_role"];
      if (audienceRole !== "member" || !from?.is_for_sale) return null;
      return from.price_cents;
    })
    .filter((c): c is number => typeof c === "number" && c > 0);

  return {
    boothCents,
    memberRegistrationCents: memberPrices.length > 0 ? Math.min(...memberPrices) : null,
  };
}

/**
 * Real, live exhibitor-booth capacity for one conference — a catalog-size
 * figure, not a sales/registration count. This conference has 0 real
 * registrations pre-launch, so "booths sold" would misleadingly show 0;
 * "booths available" is the honest, always-populated number.
 */
export async function fetchBoothCount(db: ReturnType<typeof createAdminClient>, conferenceId: string): Promise<number> {
  const { count } = await db
    .from("conference_entities")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", conferenceId)
    .eq("kind", "booth");
  return count ?? 0;
}

/**
 * The nearest conference with coordinates set. Public-facing statuses are
 * visible to everyone; draft is visible only to admin/super_admin viewers
 * (same draft-preview convention the conference offers/cart pages already
 * use). One without location_latitude/location_longitude simply doesn't get
 * a pin rather than falling back to a city-level guess — a venue pin should
 * be exact or absent.
 *
 * The hero title is an admin-editable content block (site_content, section
 * "conference_slide"); the hero subtitle is NOT — it's the real dates and
 * venue/city, computed live every request, so it can never go stale.
 * The "By the Numbers" card mixes one real computed figure (booth capacity —
 * "number of partners" was deliberately scoped to capacity, not a live
 * registration count, since this conference has zero real registrations
 * pre-launch) with two admin-curated blocks (a stat number/label, since the
 * real session catalog mixes attendee-facing sessions with logistics entries
 * like move-in/breaks with no clean flag to separate them; and a freeform
 * "what's included" bullet list, which isn't computable from any table at all).
 */
async function fetchConferencePin(viewer: ViewerContext): Promise<HomeConferencePin | null> {
  const viewerIsAdmin = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const visibleStatuses = viewerIsAdmin ? [...VISIBLE_CONFERENCE_STATUSES, "draft"] : VISIBLE_CONFERENCE_STATUSES;

  const db = createAdminClient();
  const { data } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code, location_venue, location_city, location_province, location_latitude, location_longitude, status, start_date, end_date")
    .in("status", visibleStatuses)
    .not("location_latitude", "is", null)
    .not("location_longitude", "is", null)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data || data.location_latitude == null || data.location_longitude == null || !data.location_venue) {
    return null;
  }

  const href = `/conference/${data.year}/${data.edition_code}`;

  // Role → which CTA content block + which live price. Partner org
  // admins/members get the booth pitch, Member org admins/members get the
  // registration pitch, everyone else (public, authenticated-no-org) falls
  // back to the registration pitch too — it's the broadly-applicable one;
  // booths are a narrower B2B ask most visitors aren't the audience for.
  const isPartnerViewer = viewer.viewerLevel === "partner";
  const ctaRole = viewerIsAdmin ? "admin" : isPartnerViewer ? "partner" : "member";

  const [contentRows, prices, boothCount] = await Promise.all([
    db
      .from("site_content")
      .select("id, section, title, subtitle, body")
      .in("section", [
        "conference_slide",
        `conference_slide_cta_${ctaRole}`,
        "conference_slide_stats",
        "conference_slide_included",
      ])
      .eq("is_active", true),
    fetchConferenceStartingPrices(db, data.id),
    fetchBoothCount(db, data.id),
  ]);

  const slideBlock = contentRows.data?.find((r) => r.section === "conference_slide");
  const ctaBlock = contentRows.data?.find((r) => r.section === `conference_slide_cta_${ctaRole}`);
  const statsBlock = contentRows.data?.find((r) => r.section === "conference_slide_stats");
  const includedBlock = contentRows.data?.find((r) => r.section === "conference_slide_included");

  const priceCents = ctaRole === "partner" ? prices.boothCents : prices.memberRegistrationCents;
  const ctaTemplate = ctaBlock?.body ?? (ctaRole === "admin" ? "Manage" : "Learn More");
  const ctaLabel = priceCents != null
    ? ctaTemplate.replace("{price}", formatCtaPrice(priceCents))
    : ctaTemplate.replace(" starting at {price}", "").replace(" starting from {price}", "");

  return {
    id: data.id,
    name: data.name,
    venue: data.location_venue,
    city: data.location_city,
    province: data.location_province,
    lat: data.location_latitude,
    lng: data.location_longitude,
    isDraftPreview: data.status === "draft",
    href,
    slideTitle: slideBlock?.title ?? data.name,
    slideSubtitle: [
      data.start_date && data.end_date ? formatDateRange(data.start_date, data.end_date) : null,
      [data.location_venue, data.location_city].filter(Boolean).join(", "),
    ].filter(Boolean).join(" · "),
    // Only the title is wired for inline editing (fieldProps) on the
    // homepage — the subtitle is computed, not stored, so there's nothing to
    // edit; the CTA's underlying content-block "body" holds the raw {price}
    // template, and `ctaLabel` is the already-interpolated, real-price
    // string, so wiring inline-edit to it would let an admin overwrite the
    // {price} placeholder with a literal dollar figure.
    slideContentId: slideBlock?.id ?? null,
    ctaLabel,
    ctaHref: ctaRole === "admin" ? `/admin/conference/${data.id}` : href,
    boothCount,
    statValue: statsBlock?.title ?? null,
    statLabel: statsBlock?.subtitle ?? null,
    statContentId: statsBlock?.id ?? null,
    includedItems: (includedBlock?.body ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    includedContentId: includedBlock?.id ?? null,
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
    .eq("is_test", false)
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

export async function getHomeSlides(viewer: ViewerContext): Promise<HomeSlides> {
  const [conferencePin, newestOrgSlide, sponsorSlide, personalizedSlide] = await Promise.all([
    fetchConferencePin(viewer),
    fetchNewestOrgSlide(),
    fetchSponsorSlide(),
    fetchPersonalizedSlide(viewer),
  ]);

  return { conferencePin, newestOrgSlide, sponsorSlide, personalizedSlide };
}
