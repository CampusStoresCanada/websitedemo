/**
 * Resolving a badge scan.
 *
 * One printed code, one route, and the outcome comes from the PAIR: who is
 * scanning (the session) and who was scanned (the token). Nothing about the
 * outcome is encoded on the badge, which is what lets the behaviour keep
 * changing after the cards are printed.
 *
 * ⛔ The gesture is identical in every case; the consequence is not. A vendor
 * scanning a member sends that member's details to a third party's CRM, so it
 * is gated on the member's consent. A member scanning anyone — vendor or member
 * — discloses nothing outside CSC. Same act, different destination, so they are
 * not the same thing and must not be collapsed.
 */

import { getIdentitySnapshot } from "@/lib/auth/guards";
import type { UserOrganization } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_PROFILE_RESOLVABLE_STATUSES } from "@/lib/membership/status";
import { findBadgeTokenRow } from "@/lib/conference/badges/tokens";
import { loadSeatHoldings } from "@/lib/conference/seats";
import {
  getBadgeScanRules,
  type BadgeScanRules,
  type ScanDestination,
  type ScanDirection,
} from "@/lib/conference/badges/rules";

/** The classification half of a conference's badge scan rules. */
export type ScanClassificationPolicy = Pick<
  BadgeScanRules,
  "disclosingOrgTypes" | "attendeeOrgTypes" | "unlistedOrgTypeDiscloses"
>;

/**
 * Does a scan BY this org type take an attendee's details off-platform?
 *
 * The fallback applies here, and defaults to asking: being asked unnecessarily
 * is recoverable, being shared without being asked is not.
 */
function scannerDisclosesBy(
  orgType: string | null,
  policy: ScanClassificationPolicy
): boolean {
  if (orgType === null) return false;
  if (policy.disclosingOrgTypes.includes(orgType)) return true;
  // ⛔ Known attendees are NOT caught by the fallback. Without this the default
  // swallowed members too, and every member scanning a peer raised a consent
  // request about a disclosure that was never going to happen. Two lists exist
  // precisely so "known attendee" and "nobody has classified this" are
  // different answers.
  if (policy.attendeeOrgTypes.includes(orgType)) return false;
  return policy.unlistedOrgTypeDiscloses;
}

/**
 * Is the SCANNED party a company being looked up, rather than an attendee whose
 * details the gate exists to protect?
 *
 * ⛔ Strict list membership — the fallback deliberately does NOT apply here.
 * The fallback errs toward asking, which protects people; applying it to this
 * side would do the reverse, quietly reclassifying unrecognised attendees as
 * companies and skipping the consent gate entirely. Tests caught exactly that.
 */
function scannedIsCompany(
  orgType: string | null,
  policy: ScanClassificationPolicy
): boolean {
  return orgType !== null && policy.disclosingOrgTypes.includes(orgType);
}

/**
 * Where a scan goes.
 *
 * ⛔ This is now the CONFERENCE's answer, not ours. The direction (who is
 * standing there) is derived; the destination is looked up in that conference's
 * rules. A conference with no community can send peer scans to the org page
 * instead of dead-ending at a Circle profile that does not exist.
 */
export type ScanOutcome = ScanDestination;

export type ScannedBadge = {
  tokenRowId: string;
  conferenceId: string;
  /** Where a self-scan goes: /conference/<year>/<edition>/map. */
  conferenceYear: number | null;
  conferenceEdition: string | null;
  personId: string;
  displayName: string | null;
  /** The person's own contact row — what /api/circle/profile/[contactId] needs. */
  contactId: string | null;
  organizationId: string | null;
  /** Where an `org` outcome sends the scanner. */
  organizationSlug: string | null;
  organizationName: string | null;
  organizationType: string | null;
  /** Drives whether `/org/<slug>` will actually resolve — see orgPageResolves. */
  organizationMembershipStatus: string | null;
};

export type Scanner = {
  userId: string;
  contactId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationType: string | null;
};

/**
 * Find the badge a scanned token belongs to.
 *
 * The plaintext is never stored, so lookup is by hash. A revoked row is not a
 * match: revoking is how a lost or reissued badge stops working, and that only
 * means anything if the check happens here.
 */
export async function resolveScanToken(token: string): Promise<ScannedBadge | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;

  const db = createAdminClient();
  const tokenRow = await findBadgeTokenRow(db, { token: trimmed });
  // A revoked badge does not scan. The desk distinguishes revoked from invalid
  // because an operator can act on the difference; a phone cannot, so it does not.
  if (!tokenRow || tokenRow.revoked_at) return null;

  const { data: instance } = await db
    .from("conference_instances")
    .select("year, edition_code")
    .eq("id", tokenRow.conference_id)
    .maybeSingle();

  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, organization_id, contact_id, canonical_person_id")
    .eq("id", tokenRow.person_id)
    .maybeSingle();
  if (!person) return null;

  let organizationName: string | null = null;
  let organizationSlug: string | null = null;
  let organizationType: string | null = null;
  let organizationMembershipStatus: string | null = null;
  if (person.organization_id) {
    const { data: org } = await db
      .from("organizations")
      .select("name, slug, type, membership_status")
      .eq("id", person.organization_id as string)
      .maybeSingle();
    organizationName = (org?.name as string) ?? null;
    organizationSlug = (org?.slug as string) ?? null;
    organizationType = (org?.type as string) ?? null;
    organizationMembershipStatus = (org?.membership_status as string) ?? null;
  }

  return {
    tokenRowId: tokenRow.id,
    conferenceId: tokenRow.conference_id,
    conferenceYear: (instance?.year as number) ?? null,
    conferenceEdition: (instance?.edition_code as string) ?? null,
    personId: person.id as string,
    displayName: (person.display_name as string) ?? null,
    // contact_id first: it is the FK-enforced column.
    contactId:
      (typeof person.contact_id === "string" && person.contact_id) ||
      (typeof person.canonical_person_id === "string" && person.canonical_person_id) ||
      null,
    organizationId: (person.organization_id as string) ?? null,
    organizationName,
    organizationSlug,
    organizationType,
    organizationMembershipStatus,
  };
}

/**
 * Will `/org/<slug>` render, or 404?
 *
 * Reuses the list the org page itself filters on rather than restating it —
 * two answers to "does this profile exist" would drift, and the drift would
 * show up as a dead end in someone's hand at a conference.
 *
 * Lapsed orgs (grace, locked, canceled) DO resolve; they degrade to public
 * content. Only pre-onboarding (applied, approved, null) has nothing to show.
 */
export function orgPageResolves(membershipStatus: string | null): boolean {
  return (ORG_PROFILE_RESOLVABLE_STATUSES as string[]).includes(membershipStatus ?? "");
}

/**
 * Who is doing the scanning, and whether their organisation is one that would
 * take the details off-platform.
 *
 * `contacts.profile_id` is not unique — a person who works for two
 * organisations has a row for each — so a scanner can resolve to several orgs.
 * If ANY of them discloses, the scan is treated as disclosing. Over-asking for
 * consent is recoverable; disclosing without asking is not.
 */
export async function resolveScanner(userId: string): Promise<Scanner> {
  // ⛔ Do NOT re-query the viewer's organisations here. `getIdentitySnapshot`
  // already loads `user_organizations -> organizations(id, name, type, ...)`
  // for every request and memoizes it with React.cache(); a second query for
  // the same `type` is a second answer to a question the request already
  // answered, and the two would eventually disagree.
  const snapshot = await getIdentitySnapshot();
  const orgs: UserOrganization[] =
    snapshot.status === "resolved" ? (snapshot.organizations ?? []) : [];

  // A person who works for two organisations has a row for each. If ANY of them
  // discloses, treat the scan as disclosing: over-asking for consent is
  // recoverable, disclosing without asking is not.
  // ⛔ No rules read here. Which org types disclose is a CONFERENCE decision and
  // this function does not know the conference — classifyScan does, via the
  // badge. Picking a "disclosing" org here would have to guess whose rules apply.
  const chosen = orgs[0] ?? null;
  const org = chosen?.organization ?? null;

  // The contact id is badge-specific (it is what conference_people points at),
  // so it is still resolved here — the snapshot carries the profile, not the
  // per-organisation contact rows.
  const db = createAdminClient();
  const { data: contacts } = await db
    .from("contacts")
    .select("id, organization_id")
    .eq("profile_id", userId);
  const contactRow =
    (contacts ?? []).find((c) => c.organization_id === org?.id) ?? (contacts ?? [])[0] ?? null;

  return {
    userId,
    contactId: (contactRow?.id as string) ?? null,
    organizationId: org?.id ?? null,
    organizationName: org?.name ?? null,
    organizationType: org?.type ?? null,
  };
}

/** Is this person scanning their own badge? */
async function isSelfScan(userId: string, badge: ScannedBadge): Promise<boolean> {
  const db = createAdminClient();
  const { data: contacts } = await db
    .from("contacts")
    .select("id")
    .eq("profile_id", userId);
  const ids = new Set((contacts ?? []).map((c) => c.id as string));

  const { data: person } = await db
    .from("conference_people")
    .select("contact_id, canonical_person_id")
    .eq("id", badge.personId)
    .maybeSingle();
  if (!person) return false;
  // contact_id first: it is the FK-enforced column. canonical_person_id has no
  // foreign key and this conference already carries one dangling value.
  return (
    (typeof person.contact_id === "string" && ids.has(person.contact_id)) ||
    (typeof person.canonical_person_id === "string" && ids.has(person.canonical_person_id))
  );
}

/**
 * The rule itself, with no database in it.
 *
 * Kept pure and exported so the consequential decision — does this scan
 * disclose someone's details to a third party — can be tested without a live
 * conference and without notifying a real person to find out.
 */
/**
 * WHO is standing there. A fact about the pair, derived from org types.
 *
 * ⛔ Pure and destination-free on purpose. Conflating this with where the scan
 * goes is what made the destinations impossible to configure without touching
 * the consent logic.
 */
export function decideScanDirection(input: {
  isSelf: boolean;
  scannerOrgType: string | null;
  scannedOrgType: string | null;
  policy: ScanClassificationPolicy;
}): ScanDirection {
  if (input.isSelf) return "self";
  const scannerDiscloses = scannerDisclosesBy(input.scannerOrgType, input.policy);
  const scannedIsVendor = scannedIsCompany(input.scannedOrgType, input.policy);
  if (scannerDiscloses) {
    return scannedIsVendor ? "companyToCompany" : "companyToAttendee";
  }
  return scannedIsVendor ? "attendeeToCompany" : "attendeeToAttendee";
}

/** Where this conference sends that direction. */
export function decideScanOutcome(input: {
  isSelf: boolean;
  scannerOrgType: string | null;
  scannedOrgType: string | null;
  policy: ScanClassificationPolicy;
  destinations: Record<ScanDirection, ScanDestination>;
}): ScanOutcome {
  return input.destinations[decideScanDirection(input)];
}

/**
 * What should happen for this pair. Records nothing.
 *
 * ⚠️ A scanner whose profile is not linked to a contact resolves to no
 * organisation, and therefore to `internal`. That is the safe direction for the
 * attendee, but it means an exhibitor with an unlinked login captures nothing
 * and is told it worked. Linking is an operational prerequisite for this
 * feature, not a nicety.
 */
export async function classifyScan(
  scanner: Scanner,
  badge: ScannedBadge
): Promise<ScanOutcome> {
  const rules = await getBadgeScanRules(badge.conferenceId);
  return decideScanOutcome({
    isSelf: await isSelfScan(scanner.userId, badge),
    scannerOrgType: scanner.organizationType,
    scannedOrgType: badge.organizationType,
    policy: rules,
    destinations: rules.destinations,
  });
}


export type EncounterProvenance = {
  encounter: "scheduled" | "organic";
  schedulerRunId: string | null;
};

/**
 * Did we put these two in a room, or did they find each other?
 *
 * ⛔ Answered AT SCAN TIME and stored. Never derive it afterwards: schedules
 * belong to a `scheduler_run`, a newer run can be promoted mid-conference, and
 * swaps rewrite the active run's rows in place — so the same pair flips between
 * scheduled and organic as the schedule moves underneath them, silently.
 *
 * Why it matters more than it looks: the solver seats groups of up to four
 * against an occupancy objective, not affinity, so a scheduled scan includes
 * people who shared a table because the table had a spare chair. Those get
 * EXCLUDED from match training rather than discounted. An organic scan is
 * independent evidence nobody engineered.
 *
 * "Scheduled" means the two hold seats that meet in the same booked meeting —
 * one on the exhibitor seat and one among the delegates, or both among the
 * delegates of one group.
 */
export async function resolveEncounter(params: {
  conferenceId: string;
  scannerPersonId: string | null;
  scannedPersonId: string;
}): Promise<EncounterProvenance> {
  const { conferenceId, scannerPersonId, scannedPersonId } = params;
  const db = createAdminClient();

  // The same predicate schedule-service.ts uses. Reused rather than restated so
  // "which schedule is live" cannot drift between the scanner and the scheduler.
  const { data: activeRun } = await db
    .from("scheduler_runs")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("run_mode", "active")
    .eq("status", "completed")
    .maybeSingle();

  const schedulerRunId = (activeRun?.id as string) ?? null;
  // No live schedule means nothing was engineered, so nothing can be scheduled.
  // Today this is every scan — `schedules` is empty until the solver runs, which
  // is exactly why these early rows are the cleanest evidence the table holds.
  if (!schedulerRunId || !scannerPersonId) {
    return { encounter: "organic", schedulerRunId };
  }

  // One load, filtered in memory: loadSeatHoldings pulls the whole entity graph
  // per call, so asking it twice would double that on a path a phone is waiting on.
  const { seats } = await loadSeatHoldings(db, { conferenceId, assigned: true });
  const seatsOf = (personId: string) =>
    new Set(seats.filter((s) => s.holderPersonId === personId).map((s) => s.seatId));
  const scannerSeats = seatsOf(scannerPersonId);
  const scannedSeats = seatsOf(scannedPersonId);
  if (scannerSeats.size === 0 || scannedSeats.size === 0) {
    return { encounter: "organic", schedulerRunId };
  }

  const { data: rows } = await db
    .from("schedules")
    .select("exhibitor_seat_id, delegate_seat_ids")
    .eq("conference_id", conferenceId)
    .eq("scheduler_run_id", schedulerRunId);

  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const exhibitorSeat = typeof row.exhibitor_seat_id === "string" ? row.exhibitor_seat_id : null;
    const delegateSeats = Array.isArray(row.delegate_seat_ids)
      ? (row.delegate_seat_ids as string[])
      : [];
    const inMeeting = (owned: Set<string>) =>
      (exhibitorSeat !== null && owned.has(exhibitorSeat)) ||
      delegateSeats.some((seatId) => owned.has(seatId));
    if (inMeeting(scannerSeats) && inMeeting(scannedSeats)) {
      return { encounter: "scheduled", schedulerRunId };
    }
  }

  return { encounter: "organic", schedulerRunId };
}

/** The scanner's own conference person, which is what holds seats. */
export async function resolveScannerPersonId(
  conferenceId: string,
  scanner: Scanner
): Promise<string | null> {
  if (!scanner.contactId) return null;
  const db = createAdminClient();
  // contact_id first, canonical_person_id as fallback — the precedence the badge
  // pipeline and loadSeatHoldings both use. The fallback has no foreign key.
  const { data } = await db
    .from("conference_people")
    .select("id")
    .eq("conference_id", conferenceId)
    .or(`contact_id.eq.${scanner.contactId},canonical_person_id.eq.${scanner.contactId}`)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Record the act, and open a consent request when the act would disclose.
 *
 * ⛔ Only ever called from a POST. Opening a URL must not create a lead: link
 * scanners and mail security products fetch URLs unbidden, and this repo has
 * already been bitten by Safe Links pre-clicking tokenised links.
 */
export async function recordBadgeScan(params: {
  scanner: Scanner;
  badge: ScannedBadge;
  outcome: ScanOutcome;
}): Promise<{ scanId: string; disclosureId: string | null }> {
  const { scanner, badge, outcome } = params;
  const db = createAdminClient();

  // Answered NOW, from the schedule as it stands at this instant. Storing it is
  // the whole point — see resolveEncounter.
  const { encounter, schedulerRunId } = await resolveEncounter({
    conferenceId: badge.conferenceId,
    scannerPersonId: await resolveScannerPersonId(badge.conferenceId, scanner),
    scannedPersonId: badge.personId,
  });

  const { data: scan, error } = await db
    .from("conference_badge_scans")
    .insert({
      conference_id: badge.conferenceId,
      encounter,
      scheduler_run_id: schedulerRunId,
      scanned_person_id: badge.personId,
      scanner_user_id: scanner.userId,
      scanner_contact_id: scanner.contactId,
      scanner_organization_id: scanner.organizationId,
      badge_token_id: badge.tokenRowId,
      // Where it actually went. Storing it beats re-deriving from org types
      // later: a store that lapses or a partner that becomes a member would
      // silently rewrite the history of scans that already happened.
      outcome,
    })
    .select("id")
    .single();
  if (error || !scan) {
    throw new Error(`Could not record the scan: ${error?.message ?? "no row returned"}`);
  }
  const scanId = scan.id as string;

  // `capture` is the only destination that discloses anything, and only after
  // the attendee agrees. Every other destination just moves the scanner somewhere.
  if (outcome !== "capture" || !scanner.organizationId) {
    return { scanId, disclosureId: null };
  }

  const { data: disclosure, error: disclosureError } = await db
    .from("conference_lead_disclosures")
    .insert({
      scan_id: scanId,
      conference_id: badge.conferenceId,
      member_person_id: badge.personId,
      vendor_organization_id: scanner.organizationId,
    })
    .select("id")
    .single();
  if (disclosureError) {
    throw new Error(`Could not queue the consent request: ${disclosureError.message}`);
  }

  return { scanId, disclosureId: (disclosure?.id as string) ?? null };
}

/** Has this scanner already scanned this badge? Keeps a double-tap from queuing twice. */
export async function findExistingScan(
  scannerUserId: string,
  badge: ScannedBadge
): Promise<{ scanId: string; disclosureStatus: string | null } | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("conference_badge_scans")
    .select("id, conference_lead_disclosures(status)")
    .eq("scanner_user_id", scannerUserId)
    .eq("scanned_person_id", badge.personId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const disclosures = data.conference_lead_disclosures as Array<{ status: string }> | null;
  return {
    scanId: data.id as string,
    disclosureStatus: disclosures?.[0]?.status ?? null,
  };
}

export type PendingDisclosure = {
  id: string;
  vendorName: string;
  requestedAt: string;
  status: string;
};

/**
 * The consent queue for whoever is signed in: who scanned them, and whether
 * their details have gone anywhere.
 */
export async function loadDisclosuresForUser(userId: string): Promise<PendingDisclosure[]> {
  const db = createAdminClient();
  const { data: contacts } = await db.from("contacts").select("id").eq("profile_id", userId);
  const contactIds = (contacts ?? []).map((c) => c.id as string);
  if (contactIds.length === 0) return [];

  const { data: people } = await db
    .from("conference_people")
    .select("id")
    .or(
      [
        `contact_id.in.(${contactIds.join(",")})`,
        `canonical_person_id.in.(${contactIds.join(",")})`,
      ].join(",")
    );
  const personIds = (people ?? []).map((p) => p.id as string);
  if (personIds.length === 0) return [];

  const { data } = await db
    .from("conference_lead_disclosures")
    .select("id, status, requested_at, organizations:vendor_organization_id(name)")
    .in("member_person_id", personIds)
    .order("requested_at", { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    vendorName: ((row.organizations as { name?: string } | null)?.name ?? "An exhibitor") as string,
    requestedAt: row.requested_at as string,
    status: row.status as string,
  }));
}

export type LeadRow = {
  id: string;
  status: string;
  requestedAt: string;
  personName: string;
  organizationName: string | null;
  /** Null until the attendee releases it. The gate is here, not in the view. */
  email: string | null;
};

/**
 * A vendor organisation's captured leads.
 *
 * ⛔ Contact details are attached ONLY for released rows. Withholding them in
 * the template instead would mean the address had already been sent to the
 * browser, and "nothing has been sent" would be false.
 */
export async function loadLeadsForOrganization(organizationId: string): Promise<LeadRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("conference_lead_disclosures")
    .select(
      "id, status, requested_at, conference_people:member_person_id(display_name, contact_email, organizations:organization_id(name))"
    )
    .eq("vendor_organization_id", organizationId)
    .order("requested_at", { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const person = row.conference_people as
      | { display_name?: string; contact_email?: string; organizations?: { name?: string } | null }
      | null;
    const released = row.status === "released";
    return {
      id: row.id as string,
      status: row.status as string,
      requestedAt: row.requested_at as string,
      personName: person?.display_name ?? "Attendee",
      organizationName: person?.organizations?.name ?? null,
      email: released ? (person?.contact_email ?? null) : null,
    };
  });
}
