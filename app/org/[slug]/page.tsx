import { notFound } from "next/navigation";
import { getViewerContext } from "@/lib/visibility/viewer";
import { getOrganizationForViewer } from "@/lib/visibility/data";
import { createAdminClient } from "@/lib/supabase/admin";
import MemberProfile from "@/components/org/MemberProfile";
import PartnerProfile from "@/components/org/PartnerProfile";
import OrgOnboardingCallout from "@/components/onboarding/OrgOnboardingCallout";
import { parsePartnerLinks, canViewLink } from "@/lib/partner-links";
import { resolvePartnerLinksForViewer } from "@/lib/actions/get-partner-document-url";
import { listRFPsForOrg, listRFPsForPartner } from "@/lib/actions/rfps";
import type { RFPWithContext } from "@/lib/types/rfp";
import { getPartnerMarketData, checkNudgeCooldown } from "@/lib/actions/partner-market";
import type { MarketData } from "@/lib/actions/partner-market";
import { getMemberSupplierData } from "@/lib/actions/member-suppliers";
import type { SupplierData } from "@/lib/actions/member-suppliers";
import { listEntitySeatsForOrg, type OrgEntitySeat } from "@/lib/actions/conference-entity-commerce";
import { listConferenceOffers, type ConferenceOffer, type EntityKind } from "@/lib/actions/conference-entities";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getRenewalConfig } from "@/lib/policy/engine";

type OrgConferenceAttendanceRow = {
  id: string;
  conferenceId: string;
  conferenceName: string;
  conferenceYear: number;
  conferenceEditionCode: string;
  conferenceStartDate: string | null;
  conferenceStatus: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  personKind: string;
  displayName: string | null;
  contactEmail: string | null;
  userId: string | null;
  assignmentStatus: string;
  badgeStatus: string;
  checkedInAt: string | null;
};

type RawConferenceAttendanceRow = {
  id: string;
  conference_id: string;
  organization_id: string;
  source_type: string;
  source_id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  user_id: string | null;
  assignment_status: string;
  badge_print_status: string;
  checked_in_at: string | null;
  conference_instances: {
    name: string;
    year: number;
    edition_code: string;
    start_date: string | null;
    status: string;
  } | null;
};

type OrgAssignableUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: string;
};

export type AssignableEntityColumn = {
  entityId: string;
  name: string;
  kind: EntityKind;
  seats: OrgEntitySeat[];
  /** Set only when this entity can be bought individually beyond what's included — drives the overage-to-cart flow. */
  overageOffer: { unitPriceCents: number; eligible: boolean; soldOut: boolean } | null;
};

// Viewer-dependent masking means different responses per viewer
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const viewer = await getViewerContext();

  // Quick org ID lookup so we can elevate viewer level before fetching masked data.
  // If the viewer is a member of this org, they see their own page unmasked.
  // Only ever raises the floor to "org_admin" — never lowers it. A CSC global
  // admin who also happens to belong to this org (e.g. as its real contact)
  // must keep their higher "admin"/"super_admin" level, or this would silently
  // downgrade them below what their actual role grants elsewhere on the page
  // (e.g. draft-conference visibility, which checks for admin/super_admin).
  const { data: orgIdRow } = await createAdminClient()
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  const isAlreadyCscAdmin = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const effectiveViewer = orgIdRow && viewer.viewerOrgIds.includes(orgIdRow.id) && !isAlreadyCscAdmin
    ? { ...viewer, viewerLevel: "org_admin" as const }
    : viewer;

  const { organization, contacts, brandColors, benchmarking, allBenchmarking } =
    await getOrganizationForViewer(slug, effectiveViewer);

  if (!organization) {
    notFound();
  }

  // Check for active sponsorship
  const today = new Date().toISOString().slice(0, 10);
  const { data: sponsorRow } = await (createAdminClient() as any)
    .from("sponsor_agreements")
    .select("tier:sponsor_tiers(name, slug, color, icon)")
    .eq("organization_id", organization.id)
    .eq("status", "active")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1)
    .maybeSingle();
  const sponsorTier = sponsorRow?.tier
    ? { name: sponsorRow.tier.name, slug: sponsorRow.tier.slug, color: sponsorRow.tier.color ?? "#888", icon: sponsorRow.tier.icon ?? null }
    : null;

  const canViewConferenceAttendance = viewer.viewerLevel !== "public";
  let conferenceAttendance: OrgConferenceAttendanceRow[] = [];
  let orgAssignableUsers: OrgAssignableUser[] = [];

  if (canViewConferenceAttendance) {
    const adminClient = createAdminClient();
    const { data: rows } = (await adminClient
      .from("conference_people")
      .select(
        "id, conference_id, organization_id, source_type, source_id, person_kind, display_name, contact_email, user_id, assignment_status, badge_print_status, checked_in_at, conference_instances!inner(name, year, edition_code, start_date, status)"
      )
      .eq("organization_id", organization.id)
      .neq("assignment_status", "canceled")
      .order("updated_at", { ascending: false })) as {
      data: RawConferenceAttendanceRow[] | null;
    };

    const { data: orgMemberships } = await adminClient
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", organization.id)
      .eq("status", "active")
      .eq("hidden", false);

    const userIds = Array.from(
      new Set(
        [
          ...(rows ?? []).map((row) => row.user_id),
          ...((orgMemberships ?? []).map((row) => row.user_id as string | null)),
        ].filter((value): value is string => Boolean(value))
      )
    );
    const profileNameById = new Map<string, string | null>();
    const emailById = new Map<string, string | null>();

    if (userIds.length > 0) {
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        profileNameById.set(profile.id as string, (profile.display_name as string | null) ?? null);
      }

      const authUsersResult = await adminClient.auth.admin.listUsers();
      for (const user of authUsersResult.data?.users ?? []) {
        if (!userIds.includes(user.id)) continue;
        emailById.set(user.id, user.email ?? null);
      }
    }

    conferenceAttendance = (rows ?? []).map((row) => ({
      id: row.id,
      conferenceId: row.conference_id,
      conferenceName: row.conference_instances?.name ?? "Conference",
      conferenceYear: row.conference_instances?.year ?? 0,
      conferenceEditionCode: row.conference_instances?.edition_code ?? "",
      conferenceStartDate: row.conference_instances?.start_date ?? null,
      conferenceStatus: row.conference_instances?.status ?? "draft",
      organizationId: row.organization_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      personKind: row.person_kind,
      displayName:
        row.display_name ??
        (row.user_id ? (profileNameById.get(row.user_id) ?? null) : null),
      contactEmail:
        row.contact_email ??
        (row.user_id ? (emailById.get(row.user_id) ?? null) : null),
      userId: row.user_id,
      assignmentStatus: row.assignment_status,
      badgeStatus: row.badge_print_status,
      checkedInAt: row.checked_in_at,
    }));

    orgAssignableUsers = (orgMemberships ?? [])
      .map((membership) => {
        const userId = membership.user_id as string | null;
        if (!userId) return null;
        return {
          userId,
          displayName: profileNameById.get(userId) ?? null,
          email: emailById.get(userId) ?? null,
          role: (membership.role as string | null) ?? "member",
        };
      })
      .filter((row): row is OrgAssignableUser => Boolean(row))
      .sort((a, b) => {
        const aName = (a.displayName ?? a.email ?? a.userId).toLowerCase();
        const bName = (b.displayName ?? b.email ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
  }

  // v3 conference presence — which entities (booth, registrations, optional
  // extras) this org holds seats for, and what else it could buy. Resolved
  // for the same "current conference" conferenceAttendance already implies
  // (nearest upcoming, else latest past) so both stay in sync.
  let assignableEntities: AssignableEntityColumn[] = [];
  let buyableExtras: ConferenceOffer[] = [];
  let currentConferenceId: string | null = null;
  let currentConferenceIsPublic = false;
  // An org can hold more than one booth (board decision), so this is a list.
  let heldBooths: Array<{ name: string }> = [];
  if (canViewConferenceAttendance) {
    const startById = new Map<string, number>();
    const statusById = new Map<string, string>();
    for (const row of conferenceAttendance) {
      statusById.set(row.conferenceId, row.conferenceStatus);
      if (!row.conferenceStartDate) continue;
      const start = new Date(row.conferenceStartDate).getTime();
      if (Number.isFinite(start) && !startById.has(row.conferenceId)) startById.set(row.conferenceId, start);
    }

    // conferenceAttendance alone misses a conference the org holds seats in
    // but hasn't assigned anyone to yet — every unit left "assign later," or
    // a booth, which never gets its own conference_people row at all.
    // Without this, a first-time buyer would never see anything to assign:
    // the checkbox matrix below only exists for a conference this resolves.
    const { data: heldBalanceRows } = await createAdminClient()
      .from("entity_balances")
      .select("conference_id")
      .eq("organization_id", organization.id);
    const heldConferenceIds = [...new Set((heldBalanceRows ?? []).map((r) => r.conference_id))];
    const unseenHeldIds = heldConferenceIds.filter((id) => !startById.has(id));
    if (unseenHeldIds.length > 0) {
      const { data: heldConferences } = await createAdminClient()
        .from("conference_instances")
        .select("id, start_date, status")
        .in("id", unseenHeldIds);
      for (const conf of heldConferences ?? []) {
        if (conf.status) statusById.set(conf.id, conf.status);
        const start = conf.start_date ? new Date(conf.start_date).getTime() : NaN;
        if (Number.isFinite(start)) startById.set(conf.id, start);
      }
    }

    const ids = [...new Set([...conferenceAttendance.map((r) => r.conferenceId), ...heldConferenceIds])];
    const now = new Date().getTime();
    const upcoming = ids
      .map((id) => ({ id, start: startById.get(id) }))
      .filter((e): e is { id: string; start: number } => Number.isFinite(e.start))
      .filter((e) => e.start >= now)
      .sort((a, b) => a.start - b.start);
    const latestPast = ids
      .map((id) => ({ id, start: startById.get(id) }))
      .filter((e): e is { id: string; start: number } => Number.isFinite(e.start))
      .filter((e) => e.start < now)
      .sort((a, b) => b.start - a.start);
    currentConferenceId = upcoming[0]?.id ?? latestPast[0]?.id ?? ids[0] ?? null;
    currentConferenceIsPublic = Boolean(
      currentConferenceId &&
        (PUBLIC_CONFERENCE_STATUSES as readonly string[]).includes(statusById.get(currentConferenceId) ?? "draft")
    );

    if (currentConferenceId) {
      // Booths are an org-level holding (entity_balances) — they never mint
      // a person-level seat row in entity_balance_seats, so booth ownership
      // has to be read from entity_balances directly, not listEntitySeatsForOrg.
      const [seatsResult, offersResult, boothBalanceResult] = await Promise.all([
        listEntitySeatsForOrg(currentConferenceId, organization.id),
        listConferenceOffers(currentConferenceId, organization.id),
        createAdminClient()
          .from("entity_balances")
          .select("entity:conference_entities!entity_balances_entity_id_fkey(name, kind)")
          .eq("conference_id", currentConferenceId)
          .eq("organization_id", organization.id),
      ]);
      const offerById = new Map((offersResult.success ? offersResult.data : []).map((o) => [o.id, o]));

      // The booth(s) are a place, not a person — surfaced as a plain headline
      // (heldBooths below), never as an assignable checkbox column.
      heldBooths = (boothBalanceResult.data ?? [])
        .map((b) => (Array.isArray(b.entity) ? b.entity[0] : b.entity))
        .filter((e): e is { name: string; kind: string } => e?.kind === "booth")
        .map((e) => ({ name: e.name }));

      const byEntity = new Map<string, AssignableEntityColumn>();
      for (const seat of seatsResult.success ? seatsResult.data : []) {
        // Org-level holdings (e.g. a membership renewal) and the booth
        // itself aren't something a specific person is seated into — keep
        // them out of the per-person assignment columns.
        if (seat.kind === "membership_renewal" || seat.kind === "booth") continue;
        const existing = byEntity.get(seat.entityId);
        if (existing) {
          existing.seats.push(seat);
        } else {
          const offer = offerById.get(seat.entityId);
          byEntity.set(seat.entityId, {
            entityId: seat.entityId,
            name: seat.name,
            kind: seat.kind,
            seats: [seat],
            overageOffer: offer
              ? { unitPriceCents: offer.unitPriceCents, eligible: offer.eligible, soldOut: offer.soldOut }
              : null,
          });
        }
      }
      assignableEntities = [...byEntity.values()].sort((a, b) => a.name.localeCompare(b.name));

      // Anything the org already holds at least one seat of already has its
      // own "buy 1 more" path via the assignableEntities checkbox column's
      // overageOffer — showing it here too would duplicate that. Once a
      // registration gated by requires_ownership_of becomes visible (the org
      // now owns the prerequisite, per listConferenceOffers), it belongs
      // here until the org's first purchase moves it into assignableEntities.
      const heldEntityIds = new Set(assignableEntities.map((e) => e.entityId));
      buyableExtras = (offersResult.success ? offersResult.data : []).filter(
        (o) => o.eligible && !heldEntityIds.has(o.id) && !["booth", "membership_renewal"].includes(o.kind)
      );
    }
  }

  console.log(`[org/${slug}] viewer=${viewer.viewerLevel} contacts sample: ${JSON.stringify(contacts.slice(0,3).map(c => ({ id: c.id, name: c.name, circle_id: (c as Record<string,unknown>).circle_id })))}`);

  // Fetch RFPs — for member orgs fetch their own; for partner orgs fetch matching
  let orgRFPs: RFPWithContext[] = [];
  let partnerRFPs: RFPWithContext[] = [];
  let partnerMarket: MarketData | null = null;
  let canNudge = false;
  let nudgeAvailableAt: string | null = null;
  let memberSuppliers: SupplierData | null = null;

  if (organization.type === "Member") {
    const rfpResult = await listRFPsForOrg(organization.id);
    orgRFPs = rfpResult.rfps ?? [];

    // Fetch supplier data for any member of this org
    if (viewer.viewerOrgIds.includes(organization.id)) {
      const supplierResult = await getMemberSupplierData(viewer.userEmail, organization.id);
      memberSuppliers = supplierResult.data ?? { matches: [], topMatches: [], totalMatches: 0, hasAssignments: false };
    }
  } else if (organization.type === "Partner" || organization.type === "Vendor" || organization.type === "Vendor Partner") {
    const orgExtra2 = organization as Record<string, unknown>;
    const rawCategoryValue = (orgExtra2.primary_category as string | null) ?? "";
    const partnerCategories = rawCategoryValue
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    const viewerOrgType = (organization.type as "Partner" | "Vendor") ?? null;
    if (partnerCategories.length) {
      const rfpResult = await listRFPsForPartner(partnerCategories, viewerOrgType);
      partnerRFPs = rfpResult.rfps ?? [];
    }

    // Fetch market data for any member of this partner org (or global admins)
    const isOrgMember = viewer.viewerOrgIds.includes(organization.id);
    const isGlobalAdminViewer =
      viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";

    if (isOrgMember || isGlobalAdminViewer) {
      const marketResult = await getPartnerMarketData(
        organization.id,
        (orgExtra2.primary_category as string | null) ?? null
      );
      partnerMarket = marketResult.data ?? { matches: [], topMatches: [], totalMatches: 0, withoutProcurementCount: 0 };
      const cooldown = await checkNudgeCooldown();
      canNudge = cooldown.canSend;
      nudgeAvailableAt = cooldown.availableAt ?? null;
    }
  }

  // Resolve partner links (filter by viewer, sign storage URLs server-side)
  const orgExtra = organization as Record<string, unknown>;
  // effectiveViewer already has the elevated level when viewing own org.
  const effectiveViewerLevel = effectiveViewer.viewerLevel;

  const rawPartnerLinks = parsePartnerLinks(orgExtra.partner_links ?? []);
  const { visible: visibleLinks, hasGated, gatedVisibility } =
    await resolvePartnerLinksForViewer(rawPartnerLinks, effectiveViewerLevel);

  // Org admins and super/admins can edit links — raw links needed for the editor
  const canEditLinks =
    viewer.viewerLevel === "super_admin" ||
    viewer.viewerLevel === "admin" ||
    viewer.viewerOrgAdminIds.includes(organization.id);
  const editorRawLinks = canEditLinks ? rawPartnerLinks : undefined;

  // Self-serve renewal ("Renew Now") is CSC-staff-only for now, and only
  // surfaced once the org is within the same admin-configured reminder
  // window (renewal.reminder_days, in Policy Settings → Renewals) the
  // automated reminder cron uses — so "how many days before renewal this
  // becomes relevant" stays one shared, admin-editable setting instead of a
  // second one drifting out of sync with it. Skipped entirely for viewers
  // who couldn't see the card anyway, to avoid the extra policy lookup on
  // every ordinary org-page view.
  const isCscAdminViewer = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  let renewalWindowOpen = false;
  if (isCscAdminViewer) {
    const renewalConfig = await getRenewalConfig();
    const maxReminderDay = Math.max(...renewalConfig.reminder_days);
    if (organization.membership_expires_at) {
      const daysUntilExpiry = Math.ceil(
        (new Date(organization.membership_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      renewalWindowOpen = daysUntilExpiry <= maxReminderDay;
    } else {
      // Never had a renewal cycle at all (e.g. a new org) — no future date to
      // count down to, so there's nothing to gate; always eligible.
      renewalWindowOpen = true;
    }
  }

  // Render different layouts based on organization type
  if (organization.type === "Member") {
    return (
      <>
        <OrgOnboardingCallout orgSlug={slug} />
        <MemberProfile
        organization={organization}
        contacts={contacts}
        brandColors={brandColors}
        benchmarking={benchmarking}
        allBenchmarking={allBenchmarking}
        viewerLevel={effectiveViewerLevel}
        conferenceAttendance={conferenceAttendance}
        orgAssignableUsers={orgAssignableUsers}
        assignableEntities={assignableEntities}
        buyableExtras={buyableExtras}
        currentConferenceId={currentConferenceId}
        currentConferenceIsPublic={currentConferenceIsPublic}
        sponsorTier={sponsorTier}
        initialRFPs={orgRFPs}
        memberSuppliers={memberSuppliers}
        renewalWindowOpen={renewalWindowOpen}
      />
      </>
    );
  }

  // Partner/Vendor layout
  return (
    <>
      <OrgOnboardingCallout orgSlug={slug} />
      <PartnerProfile
      organization={organization}
      contacts={contacts}
      brandColors={brandColors}
      viewerLevel={viewer.viewerLevel}
      conferenceAttendance={conferenceAttendance}
      orgAssignableUsers={orgAssignableUsers}
      assignableEntities={assignableEntities}
      buyableExtras={buyableExtras}
      currentConferenceId={currentConferenceId}
      heldBooths={heldBooths}
      sponsorTier={sponsorTier}
      visibleLinks={visibleLinks}
      hasGatedLinks={hasGated}
      rawLinks={editorRawLinks}
      canEditLinks={canEditLinks}
      partnerRFPs={partnerRFPs}
      partnerMarket={partnerMarket}
      canNudge={canNudge}
      nudgeAvailableAt={nudgeAvailableAt}
      renewalWindowOpen={renewalWindowOpen}
    />
    </>
  );
}
