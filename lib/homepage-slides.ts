import { createAdminClient } from "@/lib/supabase/admin";
import { isSpotlightExcluded } from "@/lib/membership/spotlight-exclusions";
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
      .select("from_entity:conference_entities!conference_entity_refs_from_entity_id_fkey(kind, price_cents, is_for_sale), to_entity:conference_entities!conference_entity_refs_to_entity_id_fkey(attributes)")
      .eq("conference_id", conferenceId)
      .eq("role", "who"),
  ]);

  const boothCents = boothRows?.[0]?.price_cents ?? null;

  const memberPrices = (memberRegRows ?? [])
    .map((r) => {
      const from = Array.isArray(r.from_entity) ? r.from_entity[0] : r.from_entity;
      const to = Array.isArray(r.to_entity) ? r.to_entity[0] : r.to_entity;
      const audienceRole = (to?.attributes as Record<string, unknown> | null)?.["source_role"];
      if (audienceRole !== "member" || from?.kind !== "registration" || !from?.is_for_sale) return null;
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

export const NEWEST_ORG_WINDOW_DAYS = 90;

/** Civil timezone used to decide which calendar day an activation fell on. */
const JOIN_DATE_TIMEZONE = "America/Toronto";

/**
 * A recently-joined org for the homepage spotlight slide.
 *
 * Sourced from `membership_state_log` — see fetchRecentFirstActivations() for
 * why, and why `organizations.membership_started_at` is the wrong column
 * despite the tempting name.
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
  /** YYYY-MM-DD, the day they became active. Date-only: the UI appends a time. */
  joinedOn: string;
}

export interface FirstActivation {
  organizationId: string;
  /** YYYY-MM-DD in the association's civil timezone. */
  activatedOn: string;
}

/** A timestamptz → the calendar day it fell on in Canada, as YYYY-MM-DD. */
function toCivilDate(timestamp: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what the UI expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JOIN_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

/**
 * Orgs that became active for the FIRST time inside the window, newest first.
 *
 * Reads `membership_state_log` rather than `organizations.membership_started_at`
 * for two reasons, both learned the hard way:
 *
 *  1. `membership_started_at` is not written by the activation path. It is
 *     populated for only 19 of 71 active partners and 3 of 52 active members,
 *     which is why this slide rendered nothing between Oct 2025 and Aug 2026.
 *
 *  2. It answers a different question. For a returning partner it correctly
 *     holds the date they *first* joined years ago — Niagara River Trading
 *     reads 2021 while having been reactivated in Aug 2026. That is right for
 *     "when did they join" and wrong for "are they newly arrived."
 *
 * `approved → active` is a first activation. A returning org comes back via
 * `canceled → active` (or grace/locked) and is deliberately excluded: being
 * introduced to the membership as brand new is wrong, and a bit insulting, for
 * someone who has been around for years.
 *
 * NOTE: `membership_state_log` only begins 2026-08-10. There is no history
 * before that, so this necessarily returns nothing for older orgs.
 */
export async function fetchRecentFirstActivations(
  windowDays: number = NEWEST_ORG_WINDOW_DAYS,
  limit = 25
): Promise<FirstActivation[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const db = createAdminClient();

  const { data, error } = await db
    .from("membership_state_log")
    .select("organization_id, created_at")
    .eq("to_status", "active")
    .eq("from_status", "approved")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  // An org should only ever log one approved → active, but collapse duplicates
  // defensively and keep the most recent.
  const seen = new Set<string>();
  const candidates: Array<{ organizationId: string; activatedAt: string }> = [];
  for (const row of data) {
    const organizationId = row.organization_id as string | null;
    if (!organizationId || seen.has(organizationId)) continue;
    seen.add(organizationId);
    // Held out of the automated spotlight — being introduced by hand instead.
    // Filtering here means every spotlight surface inherits it: the hero
    // slide, the derived badge, and the announcement drafter.
    if (isSpotlightExcluded(organizationId)) continue;
    candidates.push({ organizationId, activatedAt: row.created_at as string });
  }

  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.organizationId);

  // `approved → active` alone is NOT proof of newness. A returning partner
  // coming back from `canceled` passes through `approved` on the way, so the
  // final hop looks identical to a first activation. FIEL did exactly this in
  // Aug 2026 — a partner since 2024, reactivated via canceled → approved →
  // active, which the naive rule would have introduced as brand new.
  //
  // Two independent disqualifiers, either of which is enough:
  //   1. any EARLIER log entry showing a lapse or a return, and
  //   2. a membership_started_at that predates this activation.
  // The second is sparse (set on only ~a quarter of orgs) so it cannot be
  // relied on alone, but where present it is meaningful.
  const [{ data: history }, { data: orgs }] = await Promise.all([
    db
      .from("membership_state_log")
      .select("organization_id, from_status, to_status, created_at")
      .in("organization_id", ids),
    db.from("organizations").select("id, membership_started_at").in("id", ids),
  ]);

  const LAPSED = new Set(["canceled", "grace", "locked"]);
  const startedAtById = new Map(
    (orgs ?? []).map((o) => [o.id as string, (o.membership_started_at as string) ?? null])
  );

  const out: FirstActivation[] = [];
  for (const candidate of candidates) {
    const activatedMs = new Date(candidate.activatedAt).getTime();

    const hasPriorLapse = (history ?? []).some(
      (h) =>
        h.organization_id === candidate.organizationId &&
        new Date(h.created_at as string).getTime() < activatedMs &&
        (LAPSED.has(h.from_status as string) || LAPSED.has(h.to_status as string))
    );
    if (hasPriorLapse) continue;

    const startedAt = startedAtById.get(candidate.organizationId);
    if (startedAt) {
      const graceMs = 7 * 24 * 60 * 60 * 1000;
      if (new Date(startedAt).getTime() < activatedMs - graceMs) continue;
    }

    out.push({
      organizationId: candidate.organizationId,
      activatedOn: toCivilDate(candidate.activatedAt),
    });
  }

  return out;
}

export async function fetchNewestOrgSlide(): Promise<HomeNewestOrgSlide | null> {
  const activations = await fetchRecentFirstActivations();
  if (!activations.length) return null;

  const db = createAdminClient();
  const { data: orgs } = await db
    .from("organizations")
    .select("id, slug, name, type, city, province, latitude, longitude")
    .in(
      "id",
      activations.map((a) => a.organizationId)
    )
    .eq("membership_status", "active")
    .is("archived_at", null)
    .eq("is_test", false);

  if (!orgs?.length) return null;

  const byId = new Map(orgs.map((o) => [o.id as string, o]));

  // activations is already newest-first; take the first that is still a
  // listable org (one could have been archived or cancelled since activating).
  for (const activation of activations) {
    const org = byId.get(activation.organizationId);
    if (!org) continue;

    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      type: org.type,
      city: org.city ?? null,
      province: org.province ?? null,
      latitude: typeof org.latitude === "number" ? org.latitude : null,
      longitude: typeof org.longitude === "number" ? org.longitude : null,
      joinedOn: activation.activatedOn,
    };
  }

  return null;
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
