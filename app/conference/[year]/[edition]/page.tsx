import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { getMyConferenceLegalGate } from "@/lib/actions/conference-legal";
import {
  listConferenceOffers,
  getPublicConferenceFloorPlan,
  getFloorPlanForVisitor,
  getNonMemberDayPasses,
  type ConferenceFloorPlan,
} from "@/lib/actions/conference-entities";
import { nonMemberDayPassToOffer } from "@/lib/conference/entity-commerce";
import { getRequiredLegalDocumentsPublic } from "@/lib/actions/conference-legal";
import { LEGAL_DOCUMENT_LABELS, type LegalDocumentType } from "@/lib/constants/conference";
import { getBursaryProgress } from "@/lib/actions/conference-bursary";
import { getBoothTierAvailability } from "@/lib/actions/conference-availability";
import { membershipCoversConference } from "@/lib/conference/membership-gate";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import PersonaTabs from "@/components/conference/PersonaTabs";
import ConferenceHero from "@/components/conference/ConferenceHero";
import BursaryImpactStat from "@/components/conference/BursaryImpactStat";
import RegisterBursaryInterestCTA from "@/components/conference/RegisterBursaryInterestCTA";
import TuesdayAudienceNote from "@/components/conference/TuesdayAudienceNote";
import HotelInfo from "@/components/conference/HotelInfo";
import { parseHotelRates } from "@/lib/conference/hotel";
import SponsorshipLadder from "@/components/conference/SponsorshipLadder";
import ScheduleAtAGlance from "@/components/conference/ScheduleAtAGlance";
import DeadlinesTimeline from "@/components/conference/DeadlinesTimeline";
import MemberValueProps from "@/components/conference/MemberValueProps";
import DayPassOfferCard from "@/components/conference/DayPassOfferCard";
import OffersClient from "./offers/offers-client";
import ExhibitCheckoutForm from "./exhibit/exhibit-checkout-form";
import FloorPlanViewer from "./floor-plan/floor-plan-viewer";

export const metadata = { title: "Conference Hub" };

/**
 * Deliberately public — getViewerContext() falls back to an anonymous viewer
 * rather than requiring a session. Exactly one routing decision, three real
 * page bodies — each owning its own hero AND its own content as a single
 * unit, not two independently-computed pieces that can drift apart:
 *
 *   1. Member version       — cookie says Member org.
 *   2. Exhibitor version    — cookie says Vendor Partner org, OR an unknown
 *                              visitor says "Exhibitor" via PersonaTabs.
 *   3. Non-member attendee  — no cookie identifies them, and they say
 *                              "Delegate" via PersonaTabs. The only way
 *                              "non-member" ever happens for a real person —
 *                              there's no such thing as a signed-in
 *                              Non-Member org (mintProspectiveRegistration
 *                              never creates a login for one).
 *
 * A visitor with no session at all only picks between (2) and (3) — the
 * PersonaTabs chooser IS that "who are you" question. Global admins get a
 * fourth, internal-only body instead of any of the three.
 */
export default async function ConferenceEditionHubPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const viewer = await getViewerContext();
  const isGlobalAdminViewer = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const canPreviewUnpublished = isGlobalAdminViewer || hasDraftPreviewAccess(viewer.viewerOrgIds);

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code, status, start_date, end_date, location_venue, location_city, location_province, location_latitude, location_longitude, bursary_goal_cents, hotel_booking_url, hotel_booking_cutoff, hotel_rates, hotel_note")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]);
  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  let memberOrg: { id: string; name: string } | null = null;
  let partnerOrg: { id: string; name: string; membership_expires_at: string | null } | null = null;
  let needsLegal = false;
  // An org can hold more than one booth (board decision — buying a second
  // Connected booth doesn't multiply meeting time, but it's still a second
  // real booth), so this is a list, not a single held-or-not value.
  let heldBooths: Array<{ name: string; track: "exhibitor" | "bronze" }> = [];

  if (viewer.viewerLevel !== "public" && viewer.viewerOrgIds.length > 0) {
    const { data: orgRows } = await db
      .from("organizations")
      .select("id, name, type, membership_expires_at")
      .in("id", viewer.viewerOrgIds);
    memberOrg = (orgRows ?? []).find((o) => o.type === "Member") ?? null;
    if (!memberOrg) partnerOrg = (orgRows ?? []).find((o) => o.type === "Vendor Partner") ?? null;
  }

  // Already renewed through this conference's dates — the Vendor Partnership
  // pitch in the tier ladder doesn't apply to them, so it gets swapped for a
  // thank-you instead of re-selling something they've already bought.
  const partnerAlreadyRenewed =
    !!partnerOrg && membershipCoversConference(partnerOrg.membership_expires_at, conference.end_date ?? "");

  const knownOrg = memberOrg ?? partnerOrg;

  // Prefills the "Register your interest" bursary CTA so a member can submit
  // in one click without retyping their own name.
  let viewerDisplayName = "";
  if (memberOrg && viewer.userId) {
    const { data: profile } = await db.from("profiles").select("display_name").eq("id", viewer.userId).maybeSingle();
    viewerDisplayName = profile?.display_name ?? "";
  }

  // Booths are an org-level holding (entity_balances) — they never mint a
  // person-level seat row in entity_balance_seats, so booth ownership has to
  // be read from entity_balances directly, not from a seat listing.
  // The pay-first day-pass data (offers + legal docs) is needed for anyone
  // who isn't a known Member/Partner org — genuinely anonymous or otherwise —
  // since that's the entire "non-member" population there is. memberCount is
  // needed for the exhibitor hero's business-case copy whether the visitor is
  // a known partner or an anonymous one who just said "Exhibitor" — same
  // pitch either way, computed once rather than only inside a partnerOrg check.
  const [legalGate, boothBalance, nonMemberDayPasses, nonMemberLegalResult, memberCountResult] = await Promise.all([
    viewer.viewerLevel !== "public" ? getMyConferenceLegalGate(conference.id) : Promise.resolve(null),
    partnerOrg
      ? db
          .from("entity_balances")
          .select("entity:conference_entities!entity_balances_entity_id_fkey(name, kind, price_cents)")
          .eq("conference_id", conference.id)
          .eq("organization_id", partnerOrg.id)
      : Promise.resolve(null),
    !knownOrg ? getNonMemberDayPasses(conference.id) : Promise.resolve([]),
    !knownOrg ? getRequiredLegalDocumentsPublic(conference.id, ["non_member"]) : Promise.resolve(null),
    db.from("organizations").select("id", { count: "exact", head: true }).eq("type", "Member").eq("membership_status", "active").eq("is_test", false),
  ]);
  const nonMemberLegalDocs = (nonMemberLegalResult?.success ? nonMemberLegalResult.data ?? [] : []).map((d) => ({
    documentType: d.document_type,
    label: LEGAL_DOCUMENT_LABELS[d.document_type as LegalDocumentType] ?? d.document_type,
    content: d.content,
  }));
  const memberCount = memberCountResult.count ?? 0;
  needsLegal = legalGate?.success && legalGate.data ? !legalGate.data.allAccepted : false;
  if (boothBalance?.data) {
    heldBooths = boothBalance.data
      .map((b) => (Array.isArray(b.entity) ? b.entity[0] : b.entity))
      .filter((e): e is { name: string; kind: string; price_cents: number | null } => e?.kind === "booth")
      // Connected/Featured/Celebrated booths are priced at $6,000+; plain Exhibitor at $4,000.
      .map((e) => ({ name: e.name, track: (e.price_cents ?? 0) >= 600000 ? ("bronze" as const) : ("exhibitor" as const) }));
  }
  // If any held booth is Connected-tier (bronze) or above, that's the fuller
  // track — it's a superset of what plain Exhibitor unlocks.
  const heldBoothTrack: "exhibitor" | "bronze" | null =
    heldBooths.length === 0 ? null : heldBooths.some((b) => b.track === "bronze") ? "bronze" : "exhibitor";

  // Known org (Member or Partner) — embed the real storefront directly,
  // exactly what /offers renders, so add-to-cart happens right here.
  let offers: Awaited<ReturnType<typeof listConferenceOffers>> | null = null;
  let floorPlan: ConferenceFloorPlan | null = null;
  let myCartOfferIds = new Set<string>();
  if (knownOrg) {
    const canSeeMap = isGlobalAdminViewer || Boolean(partnerOrg);
    const [offersResult, floorResult, cartRes] = await Promise.all([
      listConferenceOffers(conference.id, knownOrg.id),
      canSeeMap ? getPublicConferenceFloorPlan(conference.id) : Promise.resolve(null),
      canSeeMap
        ? db
            .from("cart_items")
            .select("offer_entity_id")
            .eq("conference_id", conference.id)
            .eq("organization_id", knownOrg.id)
            .not("offer_entity_id", "is", null)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        : Promise.resolve({ data: [] as Array<{ offer_entity_id: string | null }> }),
    ]);
    offers = offersResult;
    floorPlan = floorResult && "data" in floorResult && floorResult.data ? floorResult.data : null;
    myCartOfferIds = new Set((cartRes.data ?? []).map((r) => r.offer_entity_id).filter(Boolean) as string[]);
  }

  // Prospect vendor path — the real, already-built self-serve booth purchase
  // (no login required, same booth listing /exhibit uses), for a genuinely
  // anonymous visitor exploring the vendor tab. Global admins get the
  // internal admin framing instead.
  let anonymousBooths: Array<{ id: string; name: string; priceCents: number }> = [];
  // Always loaded (not just when nothing's for sale) — the interactive map
  // is the primary way anyone picks a specific booth, signed-in or not, same
  // as OffersClient's showInlineMap. Previously this only fetched when
  // anonymousBooths was empty, so the moment real sales opened, anonymous
  // visitors got dropped from the map into a plain name-ordered dropdown
  // (ExhibitCheckoutForm) — exactly backwards, since that's the moment the
  // map matters most.
  let anonymousFloorPlan: ConferenceFloorPlan | null = null;
  if (!knownOrg && !isGlobalAdminViewer) {
    const { data: purchases } = await db.from("entity_purchases").select("offer_entity_id").eq("conference_id", conference.id);
    const claimedIds = new Set((purchases ?? []).map((p) => p.offer_entity_id).filter(Boolean));
    const { data: boothRows } = await db
      .from("conference_entities")
      .select("id, name, price_cents")
      .eq("conference_id", conference.id)
      .eq("kind", "booth")
      .eq("is_for_sale", true)
      .order("name");
    anonymousBooths = (boothRows ?? [])
      .filter((b) => !claimedIds.has(b.id))
      .map((b) => ({ id: b.id, name: b.name, priceCents: b.price_cents ?? 0 }));

    const floorResult = await getFloorPlanForVisitor(conference.id);
    anonymousFloorPlan = floorResult.success ? floorResult.data : null;
  }

  const CONNECTED_BOOTH_PRICE_CENTS = 600000;
  const [bursaryResult, boothAvailability] = await Promise.all([
    getBursaryProgress(conference.id),
    getBoothTierAvailability(conference.id),
  ]);
  const bursary = bursaryResult.success ? bursaryResult.data : null;
  const connectedAvailability = boothAvailability.find((a) => a.priceCents === CONNECTED_BOOTH_PRICE_CENTS);
  const boothsTotal = connectedAvailability?.total ?? 0;
  const boothsSold = connectedAvailability ? connectedAvailability.total - connectedAvailability.remaining : 0;
  const bursarySideContent =
    bursary && (bursary.goalCents ?? 0) > 0 && boothsTotal > 0 && memberCount > 0 ? (
      <>
        <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
          Help send every member institution
        </p>
        <BursaryImpactStat boothsSold={boothsSold} boothsTotal={boothsTotal} memberCount={memberCount} />
      </>
    ) : undefined;

  // Members get the bursary ask itself in the side slot — the "is your
  // institution represented" pitch + Register your interest button — instead
  // of the funding thermometer, which is the Partner-facing framing.
  const memberSideContent = memberOrg ? (
    <div className="max-w-sm">
      <p className="text-lg text-white/80 leading-relaxed">
        Campus Stores Canada is committed to making sure your institution has a buyer represented at this
        year&apos;s conference.
      </p>
      <RegisterBursaryInterestCTA
        conferenceId={conference.id}
        organizationId={memberOrg.id}
        defaultName={viewerDisplayName}
        defaultEmail={viewer.userEmail ?? ""}
      />
    </div>
  ) : undefined;

  const hotelRates = parseHotelRates(conference.hotel_rates);
  const venue = [conference.location_venue?.trim(), conference.location_city?.trim(), conference.location_province?.trim()]
    .filter(Boolean)
    .join(", ");

  // The exhibitor hero — same business case whether the visitor is a known
  // Partner org or an anonymous visitor who just told PersonaTabs "Exhibitor".
  const exhibitorHeroCopy =
    "One conference for the entire Canadian campus store industry. This year we're lowering costs for " +
    "both members and partners, and introducing an entirely new way to participate. Every booth helps fund " +
    `our goal: sending a delegate from all ${memberCount} of our member institutions to the conference — ` +
    "the people who decide what goes on their shelves.";

  // Shared across every one of the three page bodies below — session status
  // and a legal-acceptance nudge aren't persona pitches, so they don't need
  // their own copy per version.
  const needsLegalBanner = needsLegal && (
    <Link
      href={`/conference/${year}/${edition}/welcome`}
      className="block rounded-2xl border border-amber-200 bg-amber-50 p-5 transition-all hover:border-amber-300 hover:shadow-sm"
    >
      <h2 className="text-sm font-semibold text-amber-900">Action required: accept your documents</h2>
      <p className="mt-1 text-sm text-amber-800">
        Before you can participate, please review and accept your conference documents. →
      </p>
    </Link>
  );
  const footerLinks = viewer.viewerLevel !== "public" && (
    <div className="flex flex-wrap gap-4 border-t border-[#E5E5E5] pt-6 text-sm">
      <Link href={`/conference/${year}/${edition}/cart`} className="text-[#6B6B6B] hover:text-[#1A1A1A] hover:underline">
        Cart
      </Link>
      <Link href={`/conference/${year}/${edition}/orders`} className="text-[#6B6B6B] hover:text-[#1A1A1A] hover:underline">
        Orders
      </Link>
    </div>
  );

  return (
    <div>
      {isDraftPreview && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      {knownOrg && offers ? (
        <>
          {/* Version 1 (Member) or 2 (Exhibitor, known Partner org) — a real
              cookie already told us who this is. */}
          <ConferenceHero
            name={conference.name}
            startDate={conference.start_date}
            endDate={conference.end_date}
            venue={venue}
            copy={
              partnerOrg
                ? exhibitorHeroCopy
                : "Meet the partners who matter to your store, see the full trade show floor, and connect " +
                  "with campus stores from across Canada — all in one trip."
            }
            sideContent={memberOrg ? memberSideContent : bursarySideContent}
          />
          <div className="max-w-6xl mx-auto space-y-8 px-6 py-12">
            {needsLegalBanner}
            {memberOrg && <TuesdayAudienceNote />}
            <section className="space-y-4">
              {partnerOrg && heldBooths.length > 0 ? (
                <p className="text-sm text-[#6B6B6B]">
                  <span className="mr-2 inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    Exhibiting
                  </span>
                  {partnerOrg.name} is exhibiting at{" "}
                  <span className="font-medium text-[#1A1A1A]">
                    Booth{heldBooths.length > 1 ? "s" : ""} {heldBooths.map((b) => b.name).join(", ")}
                  </span>
                  .
                </p>
              ) : null}
              {offers.success ? (
                <OffersClient
                  conferenceId={conference.id}
                  conferenceYear={year}
                  conferenceEdition={edition}
                  organizationId={knownOrg.id}
                  organizationName={knownOrg.name}
                  // listConferenceOffers returns every for-sale entity regardless
                  // of tier, just flagged eligible/ineligible (e.g. booths for a
                  // Member org, Day Pass/Full Conference for a Partner org) — on
                  // this dense, no-friction page we only ever want things this
                  // org can actually act on, so anything they're not eligible
                  // for is dropped rather than shown disabled.
                  initialOffers={offers.data.filter((o) => o.eligible)}
                  floorPlan={floorPlan}
                  myCartOfferIds={myCartOfferIds}
                  sponsorshipAnchorId={partnerOrg ? "find-your-level" : undefined}
                />
              ) : (
                <p className="text-sm text-red-600">{offers.error}</p>
              )}
              <div className="pt-4">
                <HotelInfo
                  venue={venue}
                  lat={conference.location_latitude}
                  lng={conference.location_longitude}
                  bookingUrl={conference.hotel_booking_url}
                  bookingCutoff={conference.hotel_booking_cutoff}
                  rates={hotelRates}
                  note={conference.hotel_note}
                />
              </div>
              {partnerOrg && (
                <div className="pt-4">
                  <SponsorshipLadder conferenceId={conference.id} partnerAlreadyRenewed={partnerAlreadyRenewed} />
                </div>
              )}
              {memberOrg && (
                <div className="pt-4">
                  <MemberValueProps conferenceId={conference.id} conferenceYear={year} conferenceEdition={edition} />
                </div>
              )}
              <ScheduleAtAGlance
                conferenceId={conference.id}
                conferenceStartDate={conference.start_date ?? ""}
                track={memberOrg ? "delegate" : heldBoothTrack}
              />
              {partnerOrg && (
                <DeadlinesTimeline
                  conferenceId={conference.id}
                  conferenceStartDate={conference.start_date ?? ""}
                  conferenceEndDate={conference.end_date ?? ""}
                  audiences={["Partner"]}
                />
              )}
              {memberOrg && (
                <DeadlinesTimeline
                  conferenceId={conference.id}
                  conferenceStartDate={conference.start_date ?? ""}
                  conferenceEndDate={conference.end_date ?? ""}
                  audiences={["Member"]}
                />
              )}
            </section>
            {footerLinks}
          </div>
        </>
      ) : !isGlobalAdminViewer ? (
        <PersonaTabs
          attendee={
            // Version 3 — no cookie identifies them, and they just told
            // PersonaTabs "Delegate". The only real "non-member" case there
            // is, so it gets the real hero built for it, not the Member/
            // Exhibitor one.
            <>
              <ConferenceHero
                name={conference.name}
                startDate={conference.start_date}
                endDate={conference.end_date}
                venue={venue}
                copy="Spend the day on the trade show floor — see what's new, talk directly with the vendors who supply campus stores across Canada, and every meal is on us. No membership, no account, no scheduled meetings required."
                sideContent={
                  <>
                    <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
                      Is your school eligible to join?
                    </p>
                    <p className="max-w-xs text-sm text-white/80 leading-relaxed">
                      CSC membership is open to institutionally owned university, college, polytechnic,
                      and CEGEP bookstores — and other campus retail operations — across Canada. Members
                      get curated partner meetings, a share of the delegate travel bursary, and year-round
                      community access.
                    </p>
                    <Link
                      href="/membership"
                      className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-[#163D6D] transition-all hover:bg-white/90"
                    >
                      Apply for membership →
                    </Link>
                  </>
                }
              />
              <div className="max-w-6xl mx-auto space-y-8 px-6 py-12">
                {needsLegalBanner}
                <div className="space-y-8">
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                    <h3 className="text-sm font-semibold text-blue-900">Already a CSC member?</h3>
                    <p className="mt-1 text-sm text-blue-800">
                      If you&apos;re a member, sign in to see all the proper pricing and options — what&apos;s
                      shown below is the non-member rate.
                    </p>
                    <Link
                      href={`/login?next=${encodeURIComponent(`/conference/${year}/${edition}`)}`}
                      className="mt-3 inline-flex h-9 items-center rounded-full bg-[#163D6D] px-5 text-sm font-medium text-white transition-all hover:bg-[#0F2C50]"
                    >
                      Sign in instead →
                    </Link>
                  </div>
                  {nonMemberDayPasses.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-[#1A1A1A]">Attend without joining</h3>
                      <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">
                        Buy a single Day Pass to spend the day on the trade show floor and meet the vendors who supply
                        campus stores across Canada — no membership, no account, every meal included.
                      </p>
                      <div className="mt-4 max-w-md">
                        <DayPassOfferCard
                          offers={nonMemberDayPasses.map(nonMemberDayPassToOffer)}
                          conferenceId={conference.id}
                          conferenceYear={conference.year}
                          conferenceEdition={conference.edition_code}
                          legalDocs={nonMemberLegalDocs}
                        />
                      </div>
                      <div className="mt-6">
                        <ScheduleAtAGlance
                          conferenceId={conference.id}
                          conferenceStartDate={conference.start_date ?? ""}
                          track="non_member"
                        />
                      </div>
                    </div>
                  )}
                  <div className="rounded-2xl border border-[#E5E5E5] bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-[#1A1A1A]">Become a member instead</h3>
                    <p className="mt-1 text-sm text-[#6B6B6B]">
                      Member institutions send their whole team for the full conference — curated partner meetings, a
                      share of the delegate travel bursary, and year-round community access.
                    </p>
                    <Link
                      href="/membership"
                      className="mt-3 inline-flex h-11 items-center rounded-full bg-[#EE2A2E] px-6 text-sm font-medium text-white transition-all hover:bg-[#D92327] hover:shadow-lg hover:shadow-red-500/25"
                    >
                      Apply for membership →
                    </Link>
                  </div>
                </div>
                {footerLinks}
              </div>
            </>
          }
          vendor={
            // Version 2 (Exhibitor), anonymous variant — same hero and
            // business case a known Partner org gets; only the purchase
            // mechanism differs (prospect booth checkout, no cart).
            <>
              <ConferenceHero
                name={conference.name}
                startDate={conference.start_date}
                endDate={conference.end_date}
                venue={venue}
                copy={exhibitorHeroCopy}
                sideContent={bursarySideContent}
              />
              <div className="max-w-6xl mx-auto space-y-8 px-6 py-12">
                {needsLegalBanner}
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <h3 className="text-sm font-semibold text-blue-900">Already exhibited with us before?</h3>
                  <p className="mt-1 text-sm text-blue-800">
                    This form is for new exhibitors. If your organization has bought a booth with CSC before, sign
                    in to buy through your existing account — anything purchased below creates a new prospect
                    record instead of attaching to it.
                  </p>
                  <Link
                    href={`/login?next=${encodeURIComponent(`/conference/${year}/${edition}`)}`}
                    className="mt-3 inline-flex h-9 items-center rounded-full bg-[#163D6D] px-5 text-sm font-medium text-white transition-all hover:bg-[#0F2C50]"
                  >
                    Sign in instead →
                  </Link>
                </div>
                <div className="space-y-8">
                  {anonymousFloorPlan?.floorPlanUrl && anonymousFloorPlan.booths.length > 0 ? (
                    <div className="space-y-3">
                      <div>
                        <h2 className="text-base font-semibold text-[#1A1A1A]">Choose a Booth</h2>
                        <p className="text-sm text-[#6B6B6B]">
                          {anonymousFloorPlan.booths.filter((b) => b.status === "available").length > 0
                            ? `${anonymousFloorPlan.booths.filter((b) => b.status === "available").length} of ${anonymousFloorPlan.booths.length} available`
                            : "Booth sales haven't opened yet — take a look around"}
                        </p>
                      </div>
                      <FloorPlanViewer
                        conferenceId={conference.id}
                        conferenceYear={year}
                        conferenceEdition={edition}
                        organizationId={null}
                        floorPlanUrl={anonymousFloorPlan.floorPlanUrl}
                        booths={anonymousFloorPlan.booths}
                        sponsorshipAnchorId="find-your-level"
                      />
                    </div>
                  ) : anonymousBooths.length > 0 ? (
                    <ExhibitCheckoutForm
                      conferenceId={conference.id}
                      conferenceYear={conference.year}
                      conferenceEdition={conference.edition_code}
                      booths={anonymousBooths}
                    />
                  ) : (
                    <div className="rounded-2xl border border-[#E5E5E5] bg-white p-6 text-sm text-[#6B6B6B] shadow-sm">
                      No booths are currently available for this conference.
                    </div>
                  )}
                  <SponsorshipLadder conferenceId={conference.id} />
                  <ScheduleAtAGlance conferenceId={conference.id} conferenceStartDate={conference.start_date ?? ""} track={null} />
                  <DeadlinesTimeline
                    conferenceId={conference.id}
                    conferenceStartDate={conference.start_date ?? ""}
                    conferenceEndDate={conference.end_date ?? ""}
                    audiences={["Partner"]}
                  />
                  <HotelInfo
                  venue={venue}
                  lat={conference.location_latitude}
                  lng={conference.location_longitude}
                  bookingUrl={conference.hotel_booking_url}
                  bookingCutoff={conference.hotel_booking_cutoff}
                  rates={hotelRates}
                  note={conference.hotel_note}
                />
                </div>
                {footerLinks}
              </div>
            </>
          }
        />
      ) : (
        // Only global admins land here — a fourth, internal-only body, not
        // one of the three real visitor versions.
        <>
          <ConferenceHero
            name={conference.name}
            startDate={conference.start_date}
            endDate={conference.end_date}
            venue={venue}
            copy="One conference, all of CSC. This year we've lowered costs and are subsidizing travel so every member institution can send someone — the connections only work when everyone's in the room."
            sideContent={bursarySideContent}
          />
          <div className="max-w-6xl mx-auto space-y-8 px-6 py-12">
            {needsLegalBanner}
            <section className="space-y-8">
              <div className="rounded-2xl border border-[#E5E5E5] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#1A1A1A]">You&apos;re signed in as a CSC admin</h2>
                <p className="mt-1 text-sm text-[#6B6B6B]">
                  This is what everyone else sees. Manage this conference from the admin tools.
                </p>
                <Link
                  href={`/admin/conference/${conference.id}/overview`}
                  className="mt-4 inline-flex h-11 items-center rounded-full bg-[#EE2A2E] px-6 text-sm font-medium text-white transition-all hover:bg-[#D92327] hover:shadow-lg hover:shadow-red-500/25"
                >
                  Manage this conference
                </Link>
              </div>
              <ScheduleAtAGlance conferenceId={conference.id} conferenceStartDate={conference.start_date ?? ""} track={null} />
            </section>
            {footerLinks}
          </div>
        </>
      )}
    </div>
  );
}
