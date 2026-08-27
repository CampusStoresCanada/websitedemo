/**
 * Database access for elections. Everything here uses the admin client.
 *
 * Two reasons, both learned the hard way elsewhere in this codebase: a session
 * client hitting a table with grants but no policy writes zero rows and returns
 * `error: null`, which reads as success; and these tables are revoked from
 * `authenticated` entirely (see the migration), because ballot secrecy is not
 * something to leave to a policy expression. Authorization is done in code,
 * above each call, against the resolved session.
 */

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import { getProgramsConfig } from "@/lib/policy/engine";
import { resolveMembershipStatus } from "@/lib/auth/org-level";
import {
  resolveElectionsConfig,
  type ElectionsConfig,
  type ReminderStep,
} from "./config";
import {
  evaluateOrgEligibility,
  summarizeEligibility,
  type EligibilityVerdict,
  type EligibilitySummary,
  type OrgEligibilityFacts,
} from "./eligibility";
import {
  evaluateCosignatures,
  evaluateCandidateEligibility,
  evaluateNominationCompleteness,
  resolveBoardInvitations,
  type CosignatureStatus,
  type CandidateEligibility,
} from "./nomination";
import { deriveSchedule, phaseOn, canCloseNominations, type ElectionSchedule } from "./schedule";
import { planReminders, reminderDueOn, type ReminderPlan } from "./reminders";
import { buildAgmScript } from "./documents/agm-script";
import { buildAgmPackage, type AgmPackage } from "./documents/agm-package";
import {
  buildResultsAnnouncement,
  type ResultsAnnouncement,
} from "./documents/results-announcement";
import { buildAgmAgenda } from "./documents/agm-agenda";
import { buildElectionTimeline, type TimelineStage } from "./timeline";
import {
  buildNominatingCommitteeReport,
  type ReportDirector,
  type ReportCandidate,
} from "./documents/nominating-committee-report";
import {
  resolveRegion,
  buildRepresentationSnapshot,
  type OrgProfile,
  type RepresentationSnapshot,
} from "./representation";
import { resolveOutcome, tallyElection, formatTally as formatElectionTally } from "./tally";
import { validateBallot, orderCandidates } from "./ballot";
import {
  resolveNoticeWindow,
  evaluateNoticeWindow,
  evaluateProxyDeadline,
} from "./agm-notice";
import {
  notifyNominee,
  notifyCosigners,
  notifyStorePermission,
  notifyNominationReady,
  notifyNominationIncomplete,
  notifyCallForNominations,
  notifyBallotsOpen,
  notifyAgmPackage,
  notifyElectionResults,
  notifyAgmNotice,
  notifyProxyForm,
  summarizeOutcomes,
  type NotifyOutcome,
} from "./notify";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(error: string): Result<T> => ({ ok: false, error });

/** Unguessable token, following the board_votes / content-change convention. */
function mintToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Today in the association's timezone, as YYYY-MM-DD. */
function today(timezone = "America/Edmonton"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export interface Election {
  id: string;
  slug: string;
  bodyId: string;
  cycleYear: number;
  seatsAvailable: number;
  status: string;
  outcome: string | null;
  schedule: ElectionSchedule;
  config: ElectionsConfig;
}

export async function getElection(slug: string): Promise<Election | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("elections")
    .select(
      "id, slug, body_id, cycle_year, seats_available, status, outcome, agm_date, nominations_open_at, nominations_close_at, ballots_open_at, ballots_close_at, config"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`[elections] failed to load "${slug}": ${error.message}`);
  if (!data) return null;

  return {
    id: data.id as string,
    slug: data.slug as string,
    bodyId: data.body_id as string,
    cycleYear: data.cycle_year as number,
    seatsAvailable: data.seats_available as number,
    status: data.status as string,
    outcome: (data.outcome as string) ?? null,
    // The STORED windows, not ones recomputed from the config. Moving the AGM
    // must never retroactively reopen a window that has already closed.
    schedule: {
      agmDate: data.agm_date as string,
      nominationsOpenAt: data.nominations_open_at as string,
      nominationsCloseAt: data.nominations_close_at as string,
      ballotsOpenAt: data.ballots_open_at as string,
      ballotsCloseAt: data.ballots_close_at as string,
    },
    // Snapshotted at creation. Never the live default.
    config: resolveElectionsConfig(data.config as Partial<ElectionsConfig>),
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Re-evaluate every organization against the election's rule and persist the
 * verdicts.
 *
 * Deliberately re-runnable and deliberately NOT cached: at CSC a store with no
 * forward expiry has an outstanding renewal, so a verdict taken in August is
 * wrong by the end of September. Callers gating an action should run this (or
 * `isOrganizationEligible`) rather than trusting a stored row.
 */
export async function evaluateElectionEligibility(
  electionId: string
): Promise<{ verdicts: EligibilityVerdict[]; summary: EligibilitySummary }> {
  const db = createAdminClient();

  const election = await db
    .from("elections")
    .select("agm_date, config")
    .eq("id", electionId)
    .single();
  if (election.error) throw new Error(`[elections] ${election.error.message}`);

  const config = resolveElectionsConfig(election.data.config as Partial<ElectionsConfig>);
  const agmDate = election.data.agm_date as string;
  const programs = await getProgramsConfig();
  const votingTypes = new Set(
    programs.filter((p) => p.permissionLevel === "member").map((p) => p.orgTypeValue)
  );

  let orgQuery = db
    .from("organizations")
    .select("id, name, type, membership_status, membership_expires_at, is_test, memberships(status, program_key, expires_at)");
  if (config.eligibility.excludeTestOrganizations) orgQuery = orgQuery.eq("is_test", false);

  const { data: orgs, error } = await orgQuery;
  if (error) throw new Error(`[elections] failed to load organizations: ${error.message}`);

  const verdicts = (orgs ?? [])
    .filter((o) => votingTypes.has(o.type as string))
    .map((o) => {
      const memberships = (o.memberships ?? []) as { status: string; program_key: string; expires_at: string | null }[];
      const programKey = programs.find((p) => p.orgTypeValue === o.type)?.key;
      const matched = memberships.find((m) => m.program_key === programKey);

      const facts: OrgEligibilityFacts = {
        organizationId: o.id as string,
        name: o.name as string,
        membershipStatus: resolveMembershipStatus(
          o as Parameters<typeof resolveMembershipStatus>[0],
          programs
        ),
        // organizations.membership_expires_at and memberships.expires_at drift
        // (renewal-activation.ts does not mirror). Either one covering the AGM
        // is enough — a store that has demonstrably paid must not be excluded
        // by a sync bug on our side.
        membershipExpiresAt:
          (o.membership_expires_at as string) ?? matched?.expires_at ?? null,
        isVotingProgram: true,
      };
      return evaluateOrgEligibility(facts, config.eligibility.voterRule, agmDate);
    });

  if (verdicts.length) {
    const { error: upsertError } = await db.from("election_eligibility").upsert(
      verdicts.map((v) => ({
        election_id: electionId,
        organization_id: v.organizationId,
        is_eligible: v.isEligible,
        reason_code: v.reasonCode,
        reason: v.reason,
        rule_key: v.ruleKey,
        facts: v.facts,
        evaluated_at: new Date().toISOString(),
      })),
      { onConflict: "election_id,organization_id" }
    );
    if (upsertError)
      throw new Error(`[elections] failed to store eligibility: ${upsertError.message}`);
  }

  return { verdicts, summary: summarizeEligibility(verdicts) };
}

/**
 * Can this institution TAKE PART — nominate someone, co-sign a nomination?
 *
 * Looser than `isOrganizationEligible`, which answers the ballot question. A
 * store in grace is still a member and may put a name forward; it just cannot
 * reach the ballot or vote until it has renewed. Keeping these as two questions
 * rather than one is what lets the grace policy stay at 30 days without
 * shutting members out of the nomination window entirely.
 */
export async function canOrganizationParticipate(
  electionId: string,
  organizationId: string
): Promise<EligibilityVerdict | null> {
  const db = createAdminClient();
  const { data: election } = await db
    .from("elections")
    .select("agm_date, config")
    .eq("id", electionId)
    .maybeSingle();
  if (!election) return null;

  const config = resolveElectionsConfig(election.config as Partial<ElectionsConfig>);
  const programs = await getProgramsConfig();
  const votingTypes = new Set(
    programs.filter((p) => p.permissionLevel === "member").map((p) => p.orgTypeValue)
  );

  const { data: o } = await db
    .from("organizations")
    .select("id, name, type, membership_status, membership_expires_at, memberships(status, program_key, expires_at)")
    .eq("id", organizationId)
    .maybeSingle();
  if (!o) return null;

  const memberships = (o.memberships ?? []) as { status: string; program_key: string; expires_at: string | null }[];
  const programKey = programs.find((p) => p.orgTypeValue === o.type)?.key;
  const matched = memberships.find((m) => m.program_key === programKey);

  return evaluateOrgEligibility(
    {
      organizationId: o.id as string,
      name: o.name as string,
      membershipStatus: resolveMembershipStatus(
        o as Parameters<typeof resolveMembershipStatus>[0],
        programs
      ),
      membershipExpiresAt: (o.membership_expires_at as string) ?? matched?.expires_at ?? null,
      isVotingProgram: votingTypes.has(o.type as string),
    },
    config.eligibility.participationRule,
    election.agm_date as string
  );
}

/** Live single-org check, for gating an action at the moment it is attempted. */
export async function isOrganizationEligible(
  electionId: string,
  organizationId: string
): Promise<EligibilityVerdict | null> {
  const { verdicts } = await evaluateElectionEligibility(electionId);
  return verdicts.find((v) => v.organizationId === organizationId) ?? null;
}

// ---------------------------------------------------------------------------
// Term history — the only source for the consecutive-term cap
// ---------------------------------------------------------------------------

/**
 * Consecutive terms served on this body, as at the election.
 *
 * Returns null when the person has NO recorded history at all, which is
 * different from zero and is treated as unverifiable downstream. A candidate
 * who has genuinely never served gets an explicit zero-length history row set
 * by the admin UI, not an absence.
 *
 * Terms flagged `counts_toward_cap = false` (a mid-term appointment filling a
 * vacancy) are excluded — that exclusion is a recorded judgement, not something
 * inferred from the dates.
 */
export async function countConsecutiveTerms(
  bodyId: string,
  personProfileId: string | null,
  personContactId: string | null
): Promise<number | null> {
  if (!personProfileId && !personContactId) return null;
  const db = createAdminClient();

  let query = db
    .from("governance_role_assignments")
    .select("term_start, term_end, counts_toward_cap")
    .eq("body_id", bodyId)
    .eq("role_key", "director");

  query = personProfileId
    ? query.eq("person_profile_id", personProfileId)
    : query.eq("person_contact_id", personContactId!);

  const { data, error } = await query.order("term_start", { ascending: true });
  if (error) throw new Error(`[elections] failed to count terms: ${error.message}`);
  if (!data || data.length === 0) return null;

  return data.filter((t) => t.counts_toward_cap).length;
}

// ---------------------------------------------------------------------------
// Nominations
// ---------------------------------------------------------------------------

export interface NominationView {
  id: string;
  electionId: string;
  status: string;
  source: "nominating_committee" | "member";
  nomineeContactId: string;
  nomineeProfileId: string | null;
  nomineeOrganizationId: string;
  nomineeName: string;
  organizationName: string;
  bio: string | null;
  platform: string | null;
  candidateAcceptedAt: string | null;
  candidateDeclinedAt: string | null;
  storePermissionGrantedAt: string | null;
  withdrawnAt: string | null;
  withdrawalRequestedAt: string | null;
  acceptToken: string;
  cosignatures: CosignatureStatus;
  candidate: CandidateEligibility;
  completeness: { complete: boolean; missing: string[] };
}

async function hydrateNomination(
  nominationId: string,
  election: Election
): Promise<NominationView | null> {
  const db = createAdminClient();

  const { data: n } = await db
    .from("nominations")
    .select(
      "id, election_id, status, source, nominee_contact_id, nominee_profile_id, nominee_organization_id, bio, platform, candidate_accepted_at, candidate_declined_at, store_permission_granted_at, withdrawn_at, withdrawal_requested_at, accept_token, contacts!nominations_nominee_contact_id_fkey(first_name, last_name), organizations!nominations_nominee_organization_id_fkey(name)"
    )
    .eq("id", nominationId)
    .maybeSingle();
  if (!n) return null;

  const { data: sigs } = await db
    .from("nomination_cosignatures")
    .select("organization_id, contact_id, signed_at, revoked_at")
    .eq("nomination_id", nominationId);

  const { data: directors } = await db
    .from("governance_role_assignments")
    .select("person_contact_id")
    .eq("body_id", election.bodyId)
    .eq("role_key", "director")
    .is("term_end", null);

  const cosignatures = evaluateCosignatures(
    (sigs ?? []).map((s) => ({
      organizationId: s.organization_id as string,
      contactId: s.contact_id as string,
      signedAt: s.signed_at as string | null,
      revokedAt: s.revoked_at as string | null,
    })),
    election.config,
    {
      source: n.source as "nominating_committee" | "member",
      nomineeContactId: n.nominee_contact_id as string,
      nomineeOrganizationId: n.nominee_organization_id as string,
      sittingDirectorContactIds: (directors ?? [])
        .map((d) => d.person_contact_id as string)
        .filter(Boolean),
    }
  );

  const contact = n.contacts as { first_name: string | null; last_name: string | null } | null;
  const orgRow = n.organizations as { name: string } | null;
  const nomineeName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Unnamed nominee";

  // Two questions, two answers: may this institution take part at all, and has
  // it renewed far enough to put someone on the ballot.
  const [participation, ballotEligibility] = await Promise.all([
    canOrganizationParticipate(election.id, n.nominee_organization_id as string),
    isOrganizationEligible(election.id, n.nominee_organization_id as string),
  ]);

  const candidate = evaluateCandidateEligibility(
    {
      contactId: n.nominee_contact_id as string,
      displayName: nomineeName,
      organizationId: n.nominee_organization_id as string,
      isMemberStoreEmployee: participation?.isEligible ?? false,
      institutionRenewedThroughAgm: ballotEligibility?.isEligible ?? false,
      renewalReason: ballotEligibility?.isEligible ? null : ballotEligibility?.reason ?? null,
      consecutiveTermsServed: await countConsecutiveTerms(
        election.bodyId,
        n.nominee_profile_id as string | null,
        n.nominee_contact_id as string
      ),
    },
    election.config
  );

  const completeness = evaluateNominationCompleteness(
    {
      candidateAcceptedAt: n.candidate_accepted_at as string | null,
      candidateDeclinedAt: n.candidate_declined_at as string | null,
      storePermissionGrantedAt: n.store_permission_granted_at as string | null,
      withdrawnAt: n.withdrawn_at as string | null,
      bio: n.bio as string | null,
      platform: n.platform as string | null,
    },
    cosignatures,
    candidate,
    election.config
  );

  return {
    id: n.id as string,
    electionId: n.election_id as string,
    status: n.status as string,
    source: n.source as "nominating_committee" | "member",
    nomineeContactId: n.nominee_contact_id as string,
    nomineeProfileId: (n.nominee_profile_id as string) ?? null,
    nomineeOrganizationId: n.nominee_organization_id as string,
    nomineeName,
    organizationName: orgRow?.name ?? "Unknown institution",
    bio: n.bio as string | null,
    platform: n.platform as string | null,
    candidateAcceptedAt: n.candidate_accepted_at as string | null,
    candidateDeclinedAt: n.candidate_declined_at as string | null,
    storePermissionGrantedAt: n.store_permission_granted_at as string | null,
    withdrawnAt: n.withdrawn_at as string | null,
    withdrawalRequestedAt: n.withdrawal_requested_at as string | null,
    acceptToken: n.accept_token as string,
    cosignatures,
    candidate,
    completeness,
  };
}

export async function getNominationByToken(
  token: string
): Promise<{ nomination: NominationView; election: Election } | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("nominations")
    .select("id, elections(slug)")
    .eq("accept_token", token)
    .maybeSingle();
  if (!data) return null;

  const slug = (data.elections as { slug: string } | null)?.slug;
  if (!slug) return null;
  const election = await getElection(slug);
  if (!election) return null;

  const nomination = await hydrateNomination(data.id as string, election);
  return nomination ? { nomination, election } : null;
}

/** Is the nomination window open right now? */
export function nominationsOpen(election: Election, onDate = today()): boolean {
  const phase = phaseOn(election.schedule, onDate);
  return phase === "nominating";
}

export async function createNomination(input: {
  electionSlug: string;
  nomineeContactId: string;
  nomineeProfileId?: string | null;
  nomineeOrganizationId: string;
  source: "nominating_committee" | "member";
  nominatedByContactId?: string | null;
  /** Organizations invited to co-sign; each gets its own signing token. */
  cosignerOrganizationIds?: { organizationId: string; contactId: string }[];
  /**
   * Also invite every sitting director to co-sign.
   *
   * By-Law Part V S2(c) wants two Primary Store contacts behind a nomination,
   * which assumes the nominee knows two to ask. A first-time nominee from a
   * small store often does not, and that ignorance is not supposed to be the
   * filter. Inviting the board fans the ask out to people whose job includes
   * being asked; the first two to sign satisfy the requirement and the rest
   * lapse unsigned, which costs nothing — evaluateCosignatures counts only
   * signatures, never invitations.
   */
  requestBoardCosignature?: boolean;
}): Promise<Result<{ nominationId: string; acceptToken: string; cosignTokens: { organizationId: string; token: string }[] }>> {
  const db = createAdminClient();
  const election = await getElection(input.electionSlug);
  if (!election) return fail("That election does not exist.");

  if (election.status !== "nominating")
    return fail(`Nominations are not open — this election is ${election.status}.`);
  if (!nominationsOpen(election))
    return fail(
      `Nominations closed on ${election.schedule.nominationsCloseAt} and cannot be reopened.`
    );

  // Gated on PARTICIPATION, not on the ballot rule. A store in grace may put a
  // name forward — whether that name reaches the ballot is decided at the close,
  // by the completeness check, and it depends on the renewal being done by then.
  const orgVerdict = await canOrganizationParticipate(election.id, input.nomineeOrganizationId);
  if (!orgVerdict?.isEligible)
    return fail(orgVerdict?.reason ?? "The nominee's institution is not a member in good standing.");

  const acceptToken = mintToken();
  const { data, error } = await db
    .from("nominations")
    .insert({
      election_id: election.id,
      nominee_contact_id: input.nomineeContactId,
      nominee_profile_id: input.nomineeProfileId ?? null,
      nominee_organization_id: input.nomineeOrganizationId,
      source: input.source,
      nominated_by_contact_id: input.nominatedByContactId ?? null,
      accept_token: acceptToken,
      status: "proposed",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return fail("That person already has a live nomination in this election.");
    return fail(`Could not record the nomination: ${error.message}`);
  }

  // Directors are invited as themselves — their own contact and their own
  // store — so a board co-signature is still a Primary Store contact of a
  // member institution, exactly as S2(c) requires. It is a wider ask, not a
  // different rule, and `signedByDirectors` already records which of them
  // signed so the committee can see when a nomination leaned on the board.
  const invitations = [...(input.cosignerOrganizationIds ?? [])];

  if (input.requestBoardCosignature) {
    const { data: directors } = await db
      .from("governance_role_assignments")
      .select("person_contact_id")
      .eq("body_id", election.bodyId)
      .eq("role_key", "director")
      .is("term_end", null);

    const directorContactIds = (directors ?? [])
      .map((d) => d.person_contact_id as string)
      .filter(Boolean);

    if (directorContactIds.length > 0) {
      const { data: directorContacts } = await db
        .from("contacts")
        .select("id, organization_id")
        .in("id", directorContactIds)
        .is("archived_at", null);

      invitations.push(
        ...resolveBoardInvitations(
          (directorContacts ?? []).map((c) => ({
            contactId: c.id as string,
            organizationId: c.organization_id as string,
          })),
          invitations,
          {
            contactId: input.nomineeContactId,
            organizationId: input.nomineeOrganizationId,
          }
        )
      );
    }
  }

  const cosignTokens: { organizationId: string; token: string }[] = [];
  for (const c of invitations) {
    const token = mintToken();
    const { error: sigError } = await db.from("nomination_cosignatures").insert({
      nomination_id: data.id,
      organization_id: c.organizationId,
      contact_id: c.contactId,
      sign_token: token,
    });
    // A duplicate invitation for the same institution is not an error worth
    // failing the whole nomination over — the unique constraint is doing its job.
    if (!sigError) cosignTokens.push({ organizationId: c.organizationId, token });
  }

  return ok({ nominationId: data.id as string, acceptToken, cosignTokens });
}

export async function acceptNomination(
  token: string,
  profileId: string,
  details: { bio: string; platform: string }
): Promise<Result<NominationView>> {
  const db = createAdminClient();
  const found = await getNominationByToken(token);
  if (!found) return fail("That nomination link is not valid.");
  const { nomination, election } = found;

  // The token identifies the nomination, never the person. Only the nominee may
  // accept — a forwarded email must not be able to accept on their behalf.
  if (nomination.nomineeProfileId && nomination.nomineeProfileId !== profileId)
    return fail("Only the nominee can accept this nomination.");

  if (nomination.withdrawnAt) return fail("This nomination has been withdrawn.");
  if (nomination.candidateDeclinedAt) return fail("This nomination was already declined.");
  if (!nominationsOpen(election))
    return fail(`Nominations closed on ${election.schedule.nominationsCloseAt}.`);

  if (election.config.nominations.requireBio && !details.bio.trim())
    return fail("A biography is required to accept.");
  if (election.config.nominations.requirePlatform && !details.platform.trim())
    return fail("A candidate statement is required to accept.");

  const { error } = await db
    .from("nominations")
    .update({
      candidate_accepted_at: new Date().toISOString(),
      candidate_declined_at: null,
      bio: details.bio.trim(),
      platform: details.platform.trim(),
      status: "accepted",
      nominee_profile_id: nomination.nomineeProfileId ?? profileId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nomination.id);
  if (error) return fail(`Could not record the acceptance: ${error.message}`);

  await notifyIfNowComplete(election, nomination.id, nomination.completeness.complete);

  const fresh = await hydrateNomination(nomination.id, election);
  return fresh ? ok(fresh) : fail("Accepted, but the nomination could not be reloaded.");
}

export async function declineNomination(
  token: string,
  profileId: string
): Promise<Result<null>> {
  const db = createAdminClient();
  const found = await getNominationByToken(token);
  if (!found) return fail("That nomination link is not valid.");
  if (found.nomination.nomineeProfileId && found.nomination.nomineeProfileId !== profileId)
    return fail("Only the nominee can decline this nomination.");

  const { error } = await db
    .from("nominations")
    .update({
      candidate_declined_at: new Date().toISOString(),
      status: "declined",
      updated_at: new Date().toISOString(),
    })
    .eq("id", found.nomination.id);
  return error ? fail(error.message) : ok(null);
}

/**
 * Record a co-signature.
 *
 * The signer must be an admin of the institution that was invited — the token
 * addresses the INSTITUTION, and the by-law's two signatures mean two member
 * stores, so any of that store's admins may sign for it.
 */
export async function signCosignature(
  token: string,
  signer: { profileId: string; contactId: string; organizationIds: string[] }
): Promise<Result<CosignatureStatus>> {
  const db = createAdminClient();

  const { data: sig } = await db
    .from("nomination_cosignatures")
    .select("id, nomination_id, organization_id, signed_at, revoked_at, nominations(accept_token, nominee_contact_id, elections(slug))")
    .eq("sign_token", token)
    .maybeSingle();
  if (!sig) return fail("That signing link is not valid.");
  if (sig.revoked_at) return fail("That signature request was withdrawn.");

  if (!signer.organizationIds.includes(sig.organization_id as string))
    return fail("You are not an administrator of the institution this request was sent to.");

  const nom = sig.nominations as { nominee_contact_id: string; elections: { slug: string } } | null;
  const election = nom ? await getElection(nom.elections.slug) : null;
  if (!election) return fail("That election could not be loaded.");
  if (!nominationsOpen(election))
    return fail(`Nominations closed on ${election.schedule.nominationsCloseAt}.`);

  if (
    !election.config.nominations.selfCosignatureAllowed &&
    nom?.nominee_contact_id === signer.contactId
  )
    return fail("A nominee cannot co-sign their own nomination.");

  // Same looser test as nominating: a member in grace is still a member, and
  // its support for putting a name forward still counts. A lapsed one's does not.
  const orgVerdict = await canOrganizationParticipate(election.id, sig.organization_id as string);
  if (!orgVerdict?.isEligible)
    return fail(orgVerdict?.reason ?? "Your institution is not currently eligible to co-sign.");

  // Captured BEFORE the write, so the completion email fires on the transition
  // rather than on every subsequent signature.
  const before = await hydrateNomination(sig.nomination_id as string, election);
  const wasComplete = before?.completeness.complete ?? false;

  const { error } = await db
    .from("nomination_cosignatures")
    .update({
      signed_at: new Date().toISOString(),
      contact_id: signer.contactId,
      profile_id: signer.profileId,
    })
    .eq("id", sig.id);
  if (error) return fail(`Could not record the signature: ${error.message}`);

  await notifyIfNowComplete(election, sig.nomination_id as string, wasComplete);

  const fresh = await hydrateNomination(sig.nomination_id as string, election);
  return fresh ? ok(fresh.cosignatures) : fail("Signed, but the nomination could not be reloaded.");
}

/**
 * By-Law Part V S2(d) — the nominee's Member Store permits them to serve.
 * A separate consent from the candidate's own acceptance: agreeing to stand is
 * not the same as an employer agreeing to release them for the duties.
 */
export async function grantStorePermission(
  nominationId: string,
  grantedByContactId: string,
  grantorOrganizationIds: string[]
): Promise<Result<null>> {
  const db = createAdminClient();
  const { data: n } = await db
    .from("nominations")
    .select("id, nominee_organization_id, nominee_contact_id")
    .eq("id", nominationId)
    .maybeSingle();
  if (!n) return fail("That nomination does not exist.");

  if (!grantorOrganizationIds.includes(n.nominee_organization_id as string))
    return fail("Only an administrator of the nominee's own institution can grant this permission.");
  if (n.nominee_contact_id === grantedByContactId)
    return fail("A nominee cannot grant their own institution's permission to serve.");

  const { data: electionRow } = await db
    .from("elections")
    .select("slug")
    .eq("id", (await db.from("nominations").select("election_id").eq("id", nominationId).single()).data!.election_id)
    .single();
  const election = electionRow ? await getElection(electionRow.slug as string) : null;
  const wasComplete = election
    ? ((await hydrateNomination(nominationId, election))?.completeness.complete ?? false)
    : false;

  const { error } = await db
    .from("nominations")
    .update({
      store_permission_granted_at: new Date().toISOString(),
      store_permission_granted_by_contact_id: grantedByContactId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nominationId);
  if (error) return fail(error.message);

  if (election) await notifyIfNowComplete(election, nominationId, wasComplete);
  return ok(null);
}

/**
 * The nominating committee may ASK a nominee to step back — to improve how the
 * slate represents the membership, or where they are unlikely to be elected.
 * It cannot withdraw them. Recording the request separately is what keeps that
 * distinction visible if anyone asks later how a slate came to be shaped.
 */
export async function requestWithdrawal(
  nominationId: string,
  requestedByProfileId: string
): Promise<Result<null>> {
  const db = createAdminClient();
  const { error } = await db
    .from("nominations")
    .update({
      withdrawal_requested_at: new Date().toISOString(),
      withdrawal_requested_by: requestedByProfileId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nominationId);
  return error ? fail(error.message) : ok(null);
}

export async function withdrawNomination(
  token: string,
  profileId: string,
  reason: string | null
): Promise<Result<null>> {
  const db = createAdminClient();
  const found = await getNominationByToken(token);
  if (!found) return fail("That nomination link is not valid.");
  if (found.nomination.nomineeProfileId && found.nomination.nomineeProfileId !== profileId)
    return fail("Only the nominee can withdraw this nomination.");

  const { error } = await db
    .from("nominations")
    .update({
      withdrawn_at: new Date().toISOString(),
      withdrawn_reason: reason,
      status: "withdrawn",
      updated_at: new Date().toISOString(),
    })
    .eq("id", found.nomination.id);
  return error ? fail(error.message) : ok(null);
}

/** Every live nomination, hydrated. Feeds the committee's review view. */
export async function listNominations(electionSlug: string): Promise<NominationView[]> {
  const db = createAdminClient();
  const election = await getElection(electionSlug);
  if (!election) return [];

  const { data } = await db
    .from("nominations")
    .select("id")
    .eq("election_id", election.id)
    .not("status", "in", "(declined,withdrawn,ineligible)");

  const views: NominationView[] = [];
  for (const row of data ?? []) {
    const v = await hydrateNomination(row.id as string, election);
    if (v) views.push(v);
  }
  return views;
}

export { deriveSchedule };

// ---------------------------------------------------------------------------
// Actor resolution
// ---------------------------------------------------------------------------

export interface ElectionActor {
  profileId: string;
  /** Contact rows are keyed (person, org), so one person can have several. */
  contactIds: string[];
  /** The contact row to act as, given the organization in play. */
  contactIdFor: (organizationId: string) => string | null;
  /** Organizations where this person is an active admin. */
  adminOrganizationIds: string[];
}

/**
 * Resolve who the signed-in person is, in election terms.
 *
 * Note the (person, org) contact key: a director who also works at a second
 * member store holds two contact rows, and which one is "them" depends on which
 * institution the action is about. Callers pass the organization; they never
 * pick a contact row arbitrarily.
 */
export async function resolveActor(
  profileId: string,
  organizations: { organization_id: string; role: string; status: string }[]
): Promise<ElectionActor> {
  const db = createAdminClient();
  const { data: contacts } = await db
    .from("contacts")
    .select("id, organization_id")
    .eq("profile_id", profileId);

  const byOrg = new Map<string, string>();
  for (const c of contacts ?? []) byOrg.set(c.organization_id as string, c.id as string);

  return {
    profileId,
    contactIds: (contacts ?? []).map((c) => c.id as string),
    contactIdFor: (organizationId: string) => byOrg.get(organizationId) ?? null,
    adminOrganizationIds: organizations
      .filter((o) => o.role === "org_admin" && o.status === "active")
      .map((o) => o.organization_id),
  };
}

/** The co-signature row a token points at, with enough context to render it. */
export async function getCosignatureByToken(token: string): Promise<{
  cosignatureId: string;
  organizationId: string;
  organizationName: string;
  signedAt: string | null;
  revokedAt: string | null;
  nomination: NominationView;
  election: Election;
} | null> {
  const db = createAdminClient();
  const { data: sig } = await db
    .from("nomination_cosignatures")
    .select("id, nomination_id, organization_id, signed_at, revoked_at, organizations(name), nominations(elections(slug))")
    .eq("sign_token", token)
    .maybeSingle();
  if (!sig) return null;

  const slug = (sig.nominations as { elections: { slug: string } } | null)?.elections?.slug;
  if (!slug) return null;
  const election = await getElection(slug);
  if (!election) return null;

  const nomination = await hydrateNomination(sig.nomination_id as string, election);
  if (!nomination) return null;

  return {
    cosignatureId: sig.id as string,
    organizationId: sig.organization_id as string,
    organizationName: (sig.organizations as { name: string } | null)?.name ?? "your institution",
    signedAt: sig.signed_at as string | null,
    revokedAt: sig.revoked_at as string | null,
    nomination,
    election,
  };
}

// ---------------------------------------------------------------------------
// The nominating committee's review
// ---------------------------------------------------------------------------

/**
 * Everything the committee needs to do its job during the nomination window.
 *
 * This is what replaced a formal approval gate. The by-law has no such gate —
 * an election happens if more nominees stand than there are seats, full stop —
 * and CSC's real practice is a continuous conversation: talking to nominees who
 * are unlikely to be elected about whether they want to stand, and watching
 * whether the emerging slate reflects the membership. So this assembles a
 * picture rather than a decision, and it is meant to be looked at repeatedly
 * WHILE THERE IS STILL TIME TO ACT, not once at the close.
 */
export interface CommitteeReview {
  election: Election;
  eligibility: EligibilitySummary;
  nominations: NominationView[];
  /** Nominations that would reach the ballot as things stand. */
  validated: NominationView[];
  /** Accepted but still missing something — the committee's to-chase list. */
  incomplete: NominationView[];
  representation: RepresentationSnapshot;
  projected: { outcome: "acclaimed" | "balloted"; reason: string };
  daysUntilNominationsClose: number;
}

export async function getCommitteeReview(slug: string): Promise<CommitteeReview | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const [{ summary }, nominations] = await Promise.all([
    evaluateElectionEligibility(election.id),
    listNominations(slug),
  ]);

  const { data: eligibleRows } = await db
    .from("election_eligibility")
    .select("organization_id, organizations(name, province, fte, institution_type)")
    .eq("election_id", election.id)
    .eq("is_eligible", true);

  const toProfile = (row: {
    organization_id: string;
    organizations: { name: string; province: string | null; fte: number | null; institution_type: string | null } | null;
  }): OrgProfile | null =>
    row.organizations
      ? {
          organizationId: row.organization_id,
          name: row.organizations.name,
          province: row.organizations.province,
          fte: row.organizations.fte,
          institutionTypeConfirmed: row.organizations.institution_type,
        }
      : null;

  const eligibleOrgs = (eligibleRows ?? [])
    .map((r) => toProfile(r as Parameters<typeof toProfile>[0]))
    .filter((o): o is OrgProfile => o !== null);

  const byId = new Map(eligibleOrgs.map((o) => [o.organizationId, o]));

  // Nominee institutions repeat where a store has put several names forward —
  // that repetition is meaningful and is preserved.
  const nomineeOrgs = nominations
    .map((n) => byId.get(n.nomineeOrganizationId))
    .filter((o): o is OrgProfile => o !== undefined);

  const validated = nominations.filter((n) => n.completeness.complete);
  const incomplete = nominations.filter(
    (n) => !n.completeness.complete && n.candidateAcceptedAt
  );

  const close = new Date(`${election.schedule.nominationsCloseAt}T00:00:00Z`).getTime();
  const now = new Date(`${today()}T00:00:00Z`).getTime();

  return {
    election,
    eligibility: summary,
    nominations,
    validated,
    incomplete,
    representation: buildRepresentationSnapshot(nomineeOrgs, eligibleOrgs),
    // Projected from what would count TODAY, not from raw nomination count — a
    // nominee whose store permission is outstanding is not on the ballot yet.
    projected: resolveOutcome(validated.length, election.seatsAvailable),
    daysUntilNominationsClose: Math.round((close - now) / 86_400_000),
  };
}

// ---------------------------------------------------------------------------
// The nomination form
// ---------------------------------------------------------------------------

export interface NominatableContact {
  contactId: string;
  profileId: string | null;
  name: string;
  roleTitle: string | null;
  organizationId: string;
  organizationName: string;
}

/**
 * People who could be nominated: anyone with a contact record at a member
 * institution that is currently eligible.
 *
 * By-Law Part IV S1 limits candidacy to employees of member stores, and a
 * contact row at a member store IS our record of that employment. The list is
 * search-narrowed rather than returned whole — there are several hundred people
 * across the membership and a picker that long is not a picker.
 */
export async function listNominatableContacts(
  electionId: string,
  search: string,
  limit = 25
): Promise<NominatableContact[]> {
  const db = createAdminClient();
  const term = search.trim();
  if (term.length < 2) return [];

  const { data: eligible } = await db
    .from("election_eligibility")
    .select("organization_id")
    .eq("election_id", electionId)
    .eq("is_eligible", true);

  const eligibleIds = (eligible ?? []).map((r) => r.organization_id as string);
  if (eligibleIds.length === 0) return [];

  const { data } = await db
    .from("contacts")
    .select("id, name, first_name, last_name, role_title, profile_id, organization_id, organizations(name)")
    .in("organization_id", eligibleIds)
    .or(`name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
    .limit(limit);

  return (data ?? []).map((c) => ({
    contactId: c.id as string,
    profileId: (c.profile_id as string) ?? null,
    name:
      [c.first_name, c.last_name].filter(Boolean).join(" ") ||
      (c.name as string) ||
      "Unnamed contact",
    roleTitle: (c.role_title as string) ?? null,
    organizationId: c.organization_id as string,
    organizationName: (c.organizations as { name: string } | null)?.name ?? "Unknown institution",
  }));
}

export async function getNominatableContact(
  electionId: string,
  contactId: string
): Promise<NominatableContact | null> {
  const db = createAdminClient();
  const { data: c } = await db
    .from("contacts")
    .select("id, name, first_name, last_name, role_title, profile_id, organization_id, organizations(name)")
    .eq("id", contactId)
    .maybeSingle();
  if (!c) return null;

  const verdict = await isOrganizationEligible(electionId, c.organization_id as string);
  if (!verdict?.isEligible) return null;

  return {
    contactId: c.id as string,
    profileId: (c.profile_id as string) ?? null,
    name:
      [c.first_name, c.last_name].filter(Boolean).join(" ") ||
      (c.name as string) ||
      "Unnamed contact",
    roleTitle: (c.role_title as string) ?? null,
    organizationId: c.organization_id as string,
    organizationName: (c.organizations as { name: string } | null)?.name ?? "Unknown institution",
  };
}

/** Institutions that could be asked to co-sign, minus the ones already counted. */
export async function listCosignerOrganizations(
  electionId: string,
  excludeOrganizationIds: string[]
): Promise<{ organizationId: string; name: string }[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("election_eligibility")
    .select("organization_id, organizations(name)")
    .eq("election_id", electionId)
    .eq("is_eligible", true);

  const exclude = new Set(excludeOrganizationIds);
  return (data ?? [])
    .filter((r) => !exclude.has(r.organization_id as string))
    .map((r) => ({
      organizationId: r.organization_id as string,
      name: (r.organizations as { name: string } | null)?.name ?? "Unknown institution",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface NominationPlan {
  /** Signatures already secured at submission — normally the nominator's own. */
  automatic: { organizationId: string; name: string }[];
  /** How many more institutions must be invited. */
  stillNeeded: number;
  /**
   * A self-nomination cannot count the nominee's own institution, so it needs
   * one more invitation than nominating a colleague does. That asymmetry is
   * config (`selfCosignatureAllowed`), not a rule from the by-law, and it is
   * stated on the form rather than left to be discovered at submission.
   */
  isSelfNomination: boolean;
}

export function planNomination(
  config: ElectionsConfig,
  opts: {
    nominatorOrganizationId: string;
    nominatorOrganizationName: string;
    nominatorContactId: string;
    nomineeContactId: string;
  }
): NominationPlan {
  const isSelfNomination = opts.nominatorContactId === opts.nomineeContactId;
  const canAutoSign = !isSelfNomination || config.nominations.selfCosignatureAllowed;

  const automatic = canAutoSign
    ? [{ organizationId: opts.nominatorOrganizationId, name: opts.nominatorOrganizationName }]
    : [];

  return {
    automatic,
    stillNeeded: Math.max(0, config.nominations.cosignersRequired - automatic.length),
    isSelfNomination,
  };
}

/**
 * Submit a member-sourced nomination.
 *
 * The nominating institution's own signature is recorded immediately — putting
 * a name forward IS that institution's support, and making them separately
 * "sign" their own nomination afterwards is a step that exists only because of
 * how the table is shaped.
 */
export async function submitMemberNomination(input: {
  electionSlug: string;
  nomineeContactId: string;
  nominator: { profileId: string; contactId: string; organizationId: string };
  inviteOrganizationIds: string[];
  /**
   * Also ask the board. For a nominator who does not know two Primary Store
   * contacts to approach, this fans the ask out to people whose role includes
   * being asked, rather than letting that ignorance decide who can stand.
   */
  requestBoardCosignature?: boolean;
  /** Skip email — used by the end-to-end check so it never mails a real person. */
  suppressNotifications?: boolean;
}): Promise<
  Result<{
    nominationId: string;
    acceptToken: string;
    invitesSent: number;
    notifications: { sent: number; failed: number; problems: string[] };
  }>
> {
  const db = createAdminClient();
  const election = await getElection(input.electionSlug);
  if (!election) return fail("That election does not exist.");

  const nominee = await getNominatableContact(election.id, input.nomineeContactId);
  if (!nominee)
    return fail("That person is not at a member institution eligible to put a candidate forward.");

  const nominatorVerdict = await isOrganizationEligible(election.id, input.nominator.organizationId);
  if (!nominatorVerdict?.isEligible)
    return fail(nominatorVerdict?.reason ?? "Your institution is not currently eligible to nominate.");

  const plan = planNomination(election.config, {
    nominatorOrganizationId: input.nominator.organizationId,
    nominatorOrganizationName: "",
    nominatorContactId: input.nominator.contactId,
    nomineeContactId: input.nomineeContactId,
  });

  const invites = [...new Set(input.inviteOrganizationIds)].filter(
    (id) => !plan.automatic.some((a) => a.organizationId === id)
  );
  if (invites.length < plan.stillNeeded)
    return fail(
      `${plan.stillNeeded} more institution${plan.stillNeeded === 1 ? "" : "s"} must be asked to co-sign.`
    );

  // Resolve one admin contact per invited institution to address the request to.
  const inviteTargets: { organizationId: string; contactId: string }[] = [];
  for (const orgId of invites) {
    const { data: admin } = await db
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "org_admin")
      .eq("status", "active")
      .limit(1);
    const userId = admin?.[0]?.user_id as string | undefined;
    if (!userId) continue;
    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("profile_id", userId)
      .limit(1);
    const contactId = contact?.[0]?.id as string | undefined;
    if (contactId) inviteTargets.push({ organizationId: orgId, contactId });
  }

  const created = await createNomination({
    electionSlug: input.electionSlug,
    nomineeContactId: input.nomineeContactId,
    nomineeProfileId: nominee.profileId,
    nomineeOrganizationId: nominee.organizationId,
    source: "member",
    nominatedByContactId: input.nominator.contactId,
    cosignerOrganizationIds: inviteTargets,
    requestBoardCosignature: input.requestBoardCosignature ?? false,
  });
  if (!created.ok) return created;

  for (const auto of plan.automatic) {
    await db.from("nomination_cosignatures").insert({
      nomination_id: created.data.nominationId,
      organization_id: auto.organizationId,
      contact_id: input.nominator.contactId,
      profile_id: input.nominator.profileId,
      sign_token: mintToken(),
      signed_at: new Date().toISOString(),
    });
  }

  // The nomination is already recorded. Email is a notification of that record,
  // never a precondition for it — so failures are collected and reported, not
  // thrown, and the nomination stands either way.
  let notifications = { sent: 0, failed: 0, problems: [] as string[] };
  if (!input.suppressNotifications) {
    const { data: nominatorOrg } = await db
      .from("organizations")
      .select("name")
      .eq("id", input.nominator.organizationId)
      .maybeSingle();

    const outcomes: NotifyOutcome[] = [];
    outcomes.push(
      await notifyNominee(
        election,
        {
          id: created.data.nominationId,
          acceptToken: created.data.acceptToken,
          nomineeContactId: nominee.contactId,
          nomineeOrganizationName: nominee.organizationName,
        },
        (nominatorOrg?.name as string) ?? "A member institution"
      )
    );
    outcomes.push(
      ...(await notifyCosigners(
        election,
        { name: nominee.name, organizationName: nominee.organizationName },
        created.data.cosignTokens.map((t) => ({
          organizationId: t.organizationId,
          contactId:
            inviteTargets.find((i) => i.organizationId === t.organizationId)?.contactId ?? "",
          token: t.token,
        }))
      ))
    );
    if (election.config.nominations.requireStorePermission) {
      outcomes.push(
        ...(await notifyStorePermission(election, {
          acceptToken: created.data.acceptToken,
          nomineeContactId: nominee.contactId,
          nomineeOrganizationId: nominee.organizationId,
        }))
      );
    }
    notifications = summarizeOutcomes(outcomes);
  }

  return ok({
    nominationId: created.data.nominationId,
    acceptToken: created.data.acceptToken,
    invitesSent: created.data.cosignTokens.length,
    notifications,
  });
}

/**
 * Tell a nominee their nomination is complete — but only on the transition,
 * never on every save. `wasComplete` is the caller's before-state; without it
 * a nominee editing their biography four times gets four "you're all set"
 * emails, which is how people learn to ignore election mail.
 */
export async function notifyIfNowComplete(
  election: Election,
  nominationId: string,
  wasComplete: boolean
): Promise<NotifyOutcome | null> {
  const view = await hydrateNomination(nominationId, election);
  if (!view || wasComplete || !view.completeness.complete) return null;
  return notifyNominationReady(election, {
    acceptToken: view.acceptToken,
    nomineeContactId: view.nomineeContactId,
    nomineeOrganizationName: view.organizationName,
  });
}

/**
 * Chase every accepted-but-incomplete nomination. Intended for a scheduled run
 * as the close approaches; returns what it attempted so a caller can report it.
 */
export async function chaseIncompleteNominations(
  electionSlug: string
): Promise<{ chased: number; outcomes: NotifyOutcome[] }> {
  const election = await getElection(electionSlug);
  if (!election) return { chased: 0, outcomes: [] };

  const nominations = await listNominations(electionSlug);
  const outcomes: NotifyOutcome[] = [];
  for (const n of nominations) {
    if (n.completeness.complete || !n.candidateAcceptedAt) continue;
    outcomes.push(
      await notifyNominationIncomplete(
        election,
        { acceptToken: n.acceptToken, nomineeContactId: n.nomineeContactId },
        n.completeness.missing
      )
    );
  }
  return { chased: outcomes.length, outcomes };
}

/**
 * Send the call for nominations, once.
 *
 * Recorded against the election so it cannot be sent twice by two people
 * looking at the same screen — the membership receiving the same call an hour
 * apart reads as disorganisation at exactly the moment the association is
 * asking people to stand.
 */
export async function sendCallForNominations(
  slug: string,
  sentByProfileId: string
): Promise<Result<{ institutions: number; sent: number; failed: number; problems: string[] }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  const { data: existing } = await db
    .from("elections")
    .select("config")
    .eq("id", election.id)
    .single();
  const alreadySent = (existing?.config as { callSentAt?: string } | null)?.callSentAt;
  if (alreadySent)
    return fail(
      `The call for nominations was already sent on ${alreadySent.slice(0, 10)}. Sending it again would mail every member a second time.`
    );

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const eligible = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  if (eligible.length === 0) return fail("No institutions are currently eligible, so there is nobody to send to.");

  // ⚠️ CLAIMED BEFORE THE SEND, deliberately.
  //
  // The guard above refuses a second send once callSentAt is set, but that only
  // helps if the stamp survives. Stamping AFTER the send meant that anything
  // which killed the request part way — and a whole-electorate send is the most
  // likely thing in this codebase to do that — left no stamp at all: the
  // operator saw no confirmation, pressed again, and everyone who had already
  // received the call received it a second time. That is not hypothetical; the
  // comms campaign send did exactly this to five partners on 2026-08-26.
  //
  // Claiming first inverts the failure. A crash now leaves an election marked
  // sent with a partial delivery, which the returned summary reports and a
  // human can chase — recoverable, and quiet. The other order silently mails
  // the entire membership twice.
  //
  // Sending the call is also what OPENS nominations — they are the same act. A
  // separate button would create two states that are both wrong: nominations
  // "open" that nobody was told about, or a call sent while the form still says
  // closed. Opening early is harmless: the page also checks the SCHEDULE, so a
  // call sent ahead of nominationsOpenAt announces the dates without opening
  // the form before them.
  await db
    .from("elections")
    .update({
      status: election.status === "draft" ? "nominating" : election.status,
      config: {
        ...(existing?.config as Record<string, unknown>),
        callSentAt: new Date().toISOString(),
        callSentBy: sentByProfileId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

  const outcomes = await notifyCallForNominations(election, eligible);
  const summary = summarizeOutcomes(outcomes);

  return ok({ institutions: eligible.length, ...summary });
}

// ---------------------------------------------------------------------------
// Closing nominations — freezing the ballot
// ---------------------------------------------------------------------------

/**
 * Close nominations and fix the field.
 *
 * This exists because a ballot must not be able to change under a voter. Up to
 * this point `completeness` is computed live, so a nomination can become
 * complete the moment someone enters a missing term history. That is right
 * DURING the nomination window and intolerable after it: an institution that
 * voted on Monday would be looking at a different ballot from one that voted on
 * Friday, and nothing in the record would show it.
 *
 * So the field is written down. `status = 'validated'` IS the ballot, and
 * everything downstream reads that column rather than recomputing. A nomination
 * that fell short is marked `ineligible` with its reasons kept in `eligibility`,
 * so a nominee who asks why they are not on the ballot gets an answer.
 */
export async function closeNominations(
  slug: string
): Promise<
  Result<{
    validated: number;
    excluded: { name: string; reasons: string[] }[];
    outcome: "acclaimed" | "balloted";
    reason: string;
  }>
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");
  if (election.status !== "nominating")
    return fail(`Nominations cannot be closed from status "${election.status}".`);

  // The published window belongs to the members, not to whoever is holding the
  // button. Closing early removes the right to nominate from anyone who has not
  // acted yet — see canCloseNominations. Late is fine and merely noted.
  const readiness = canCloseNominations(election.schedule, today());
  if (!readiness.ready) return fail(readiness.reason);

  const nominations = await listNominations(slug);
  const validated = nominations.filter((n) => n.completeness.complete);
  const excluded = nominations.filter((n) => !n.completeness.complete);

  for (const n of validated) {
    await db
      .from("nominations")
      .update({ status: "validated", eligibility: n.completeness, updated_at: new Date().toISOString() })
      .eq("id", n.id);
  }
  for (const n of excluded) {
    await db
      .from("nominations")
      .update({ status: "ineligible", eligibility: n.completeness, updated_at: new Date().toISOString() })
      .eq("id", n.id);
  }

  const outcome = resolveOutcome(validated.length, election.seatsAvailable);

  await db
    .from("elections")
    .update({
      status: outcome.outcome === "balloted" ? "balloting" : "nominations_closed",
      outcome: outcome.outcome,
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

  return ok({
    validated: validated.length,
    excluded: excluded.map((n) => ({ name: n.nomineeName, reasons: n.completeness.missing })),
    ...outcome,
  });
}

// ---------------------------------------------------------------------------
// The ballot
// ---------------------------------------------------------------------------

export interface BallotCandidate {
  nominationId: string;
  displayName: string;
  organizationName: string;
  bio: string | null;
  platform: string | null;
}

/** Candidates, read from the frozen `validated` status — never recomputed. */
export async function getBallotCandidates(election: Election): Promise<BallotCandidate[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("nominations")
    .select(
      "id, bio, platform, contacts!nominations_nominee_contact_id_fkey(first_name, last_name, name), organizations!nominations_nominee_organization_id_fkey(name)"
    )
    .eq("election_id", election.id)
    .eq("status", "validated");

  const candidates = (data ?? []).map((n) => {
    const c = n.contacts as { first_name: string | null; last_name: string | null; name: string | null } | null;
    return {
      nominationId: n.id as string,
      displayName:
        [c?.first_name, c?.last_name].filter(Boolean).join(" ") || c?.name || "Unnamed candidate",
      organizationName: (n.organizations as { name: string } | null)?.name ?? "",
      bio: n.bio as string | null,
      platform: n.platform as string | null,
    };
  });

  return orderCandidates(candidates, election.config);
}

export interface BallotState {
  election: Election;
  candidates: BallotCandidate[];
  organization: { id: string; name: string } | null;
  otherOrganizations: { id: string; name: string }[];
  selections: string[];
  abstain: boolean;
  hasVoted: boolean;
  lastEditedAt: string | null;
  lastEditedByName: string | null;
  editCount: number;
  open: boolean;
  blocked: string | null;
}

export async function getBallotState(
  slug: string,
  profileId: string,
  organizations: { organization_id: string; role: string; status: string }[],
  preferredOrganizationId?: string
): Promise<BallotState | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const actor = await resolveActor(profileId, organizations);
  const eligible: { id: string; name: string }[] = [];
  let renewalBlocked: string | null = null;

  for (const orgId of actor.adminOrganizationIds) {
    const verdict = await isOrganizationEligible(election.id, orgId);
    if (verdict?.isEligible) {
      const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
      eligible.push({ id: orgId, name: (org?.name as string) ?? "Your institution" });
    } else if (verdict?.reasonCode === "renewal_outstanding") {
      renewalBlocked = verdict.reason;
    }
  }

  const open = election.status === "balloting" && phaseOn(election.schedule, today()) === "balloting";
  const candidates = await getBallotCandidates(election);
  const chosen = eligible.find((o) => o.id === preferredOrganizationId) ?? eligible[0] ?? null;

  let selections: string[] = [];
  let abstain = false;
  let hasVoted = false;
  let lastEditedAt: string | null = null;
  let lastEditedByName: string | null = null;
  let editCount = 0;

  if (chosen) {
    const { data: ballot } = await db
      .from("election_ballots")
      .select("id, abstain, last_edited_at, last_edited_by_profile_id, edit_count")
      .eq("election_id", election.id)
      .eq("organization_id", chosen.id)
      .maybeSingle();

    if (ballot) {
      hasVoted = true;
      abstain = ballot.abstain as boolean;
      lastEditedAt = ballot.last_edited_at as string;
      editCount = (ballot.edit_count as number) ?? 0;

      const { data: picks } = await db
        .from("election_ballot_selections")
        .select("nomination_id")
        .eq("ballot_id", ballot.id);
      selections = (picks ?? []).map((p) => p.nomination_id as string);

      if (ballot.last_edited_by_profile_id) {
        const { data: editor } = await db
          .from("profiles")
          .select("display_name")
          .eq("id", ballot.last_edited_by_profile_id)
          .maybeSingle();
        lastEditedByName = (editor?.display_name as string) ?? null;
      }
    }
  }

  return {
    election,
    candidates,
    organization: chosen,
    otherOrganizations: eligible.filter((o) => o.id !== chosen?.id),
    selections,
    abstain,
    hasVoted,
    lastEditedAt,
    lastEditedByName,
    editCount,
    open,
    blocked: chosen
      ? null
      : (renewalBlocked ??
        "Ballots are cast by member institutions. Your account is not recorded as an administrator of an eligible member institution."),
  };
}

/**
 * Save an institution's ballot.
 *
 * One ballot per institution, revisable by any of its administrators until the
 * close. Two admins editing the same ballot is an expected state here, not a
 * conflict to prevent — so the last write wins and `last_edited_by` is recorded
 * and shown, rather than the second person's save failing with a message about
 * a conflict they have no way to resolve.
 */
export async function saveBallot(input: {
  electionSlug: string;
  organizationId: string;
  profileId: string;
  organizations: { organization_id: string; role: string; status: string }[];
  selections: string[];
  abstain: boolean;
}): Promise<Result<{ selections: string[]; abstain: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(input.electionSlug);
  if (!election) return fail("That election does not exist.");

  if (election.status !== "balloting")
    return fail(`Voting is not open — this election is ${election.status}.`);
  if (phaseOn(election.schedule, today()) !== "balloting")
    return fail(
      `Voting ran ${election.schedule.ballotsOpenAt} to ${election.schedule.ballotsCloseAt} and is now closed.`
    );

  const actor = await resolveActor(input.profileId, input.organizations);
  if (!actor.adminOrganizationIds.includes(input.organizationId))
    return fail("You are not an administrator of that institution.");

  // Live, not from a stored verdict: an institution that completed its renewal
  // this morning can vote this afternoon.
  const verdict = await isOrganizationEligible(election.id, input.organizationId);
  if (!verdict?.isEligible)
    return fail(verdict?.reason ?? "Your institution is not currently eligible to vote.");

  const candidates = await getBallotCandidates(election);
  const validation = validateBallot(
    { selections: input.selections, abstain: input.abstain },
    candidates.map((c) => c.nominationId),
    election.seatsAvailable,
    election.config
  );
  if (!validation.valid) return fail(validation.errors.join(" "));

  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("election_ballots")
    .select("id, edit_count, first_cast_at")
    .eq("election_id", election.id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  let ballotId: string;
  if (existing) {
    ballotId = existing.id as string;
    const { error } = await db
      .from("election_ballots")
      .update({
        abstain: input.abstain,
        last_edited_at: now,
        last_edited_by_profile_id: input.profileId,
        edit_count: ((existing.edit_count as number) ?? 0) + 1,
      })
      .eq("id", ballotId);
    if (error) return fail(`Could not save the ballot: ${error.message}`);
    await db.from("election_ballot_selections").delete().eq("ballot_id", ballotId);
  } else {
    const { data, error } = await db
      .from("election_ballots")
      .insert({
        election_id: election.id,
        organization_id: input.organizationId,
        abstain: input.abstain,
        first_cast_at: now,
        last_edited_at: now,
        last_edited_by_profile_id: input.profileId,
        edit_count: 0,
      })
      .select("id")
      .single();
    if (error || !data) return fail(`Could not save the ballot: ${error?.message}`);
    ballotId = data.id as string;
  }

  if (!input.abstain && input.selections.length > 0) {
    const { error } = await db.from("election_ballot_selections").insert(
      [...new Set(input.selections)].map((nominationId) => ({
        ballot_id: ballotId,
        nomination_id: nominationId,
      }))
    );
    if (error) return fail(`Could not save your selections: ${error.message}`);
  }

  // The participation roll — this is what survives sealing, and afterwards it is
  // the only thing showing that this institution voted at all.
  const { data: participation } = await db
    .from("election_participation")
    .select("id, cast_by_profile_ids, edit_count, first_cast_at")
    .eq("election_id", election.id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const voters = new Set<string>((participation?.cast_by_profile_ids as string[]) ?? []);
  voters.add(input.profileId);

  await db.from("election_participation").upsert(
    {
      election_id: election.id,
      organization_id: input.organizationId,
      first_cast_at: (participation?.first_cast_at as string) ?? now,
      last_edited_at: now,
      edit_count: ((participation?.edit_count as number) ?? 0) + (participation ? 1 : 0),
      cast_by_profile_ids: [...voters],
      abstained: input.abstain,
    },
    { onConflict: "election_id,organization_id" }
  );

  return ok({ selections: input.selections, abstain: input.abstain });
}

/** Turnout, from ballots returned — never from email opens. */
export async function getTurnout(
  slug: string
): Promise<{ eligible: number; returned: number; abstained: number; outstanding: number } | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const { summary } = await evaluateElectionEligibility(election.id);
  const { data: ballots } = await db
    .from("election_participation")
    .select("abstained")
    .eq("election_id", election.id);

  const returned = ballots?.length ?? 0;
  return {
    eligible: summary.eligible,
    returned,
    abstained: (ballots ?? []).filter((b) => b.abstained).length,
    outstanding: Math.max(0, summary.eligible - returned),
  };
}

// ---------------------------------------------------------------------------
// Seal, count, certify
// ---------------------------------------------------------------------------

export interface SealResult {
  sealed: number;
  participation: number;
  reconciled: boolean;
}

/**
 * Seal the ballots. Irreversible.
 *
 * The work happens in `seal_election()` so it is one transaction — see that
 * function for why a partial seal is worse than either outcome. This wrapper
 * exists to check the window has actually closed and to report the
 * reconciliation, which is the number a scrutineer will be asked about: the
 * count of sealed ballots must equal the count of institutions recorded as
 * having voted. If those disagree, something was lost, and it is unrecoverable
 * — so it is surfaced immediately rather than discovered at certification.
 */
export async function sealElection(slug: string): Promise<Result<SealResult>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");
  if (election.status !== "balloting")
    return fail(`This election is "${election.status}" — only a balloting election can be sealed.`);

  // Refuse while voting is still open. Sealing mid-vote would silently discard
  // every ballot cast afterwards, because the linked rows are gone.
  if (phaseOn(election.schedule, today()) === "balloting")
    return fail(
      `Voting is still open until ${election.schedule.ballotsCloseAt}. Sealing now would discard every ballot cast between now and then.`
    );

  const { data, error } = await db.rpc("seal_election", { p_election_id: election.id });
  if (error) return fail(`The seal did not complete: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const sealed = (row?.sealed_count as number) ?? 0;
  const participation = (row?.participation_count as number) ?? 0;

  return ok({ sealed, participation, reconciled: sealed === participation });
}

export interface CountedResult {
  nominationId: string;
  displayName: string;
  organizationName: string;
  votes: number;
  rank: number;
  elected: boolean;
  tiedAtCutoff: boolean;
}

export interface ElectionCount {
  seats: number;
  ballotsCounted: number;
  abstentions: number;
  blankBallots: number;
  results: CountedResult[];
  tieAtCutoff: boolean;
  tiedCandidates: CountedResult[];
  seatsResolved: number;
  certifiable: boolean;
  /** True when a tie existed and a human has recorded how it was settled. */
  tieSettled: boolean;
  summary: string;
}

/**
 * Count the sealed ballots and persist the result.
 *
 * Re-runnable: the sealed ballots do not change, so counting twice gives the
 * same answer. That matters for a scrutineer who wants to satisfy themselves by
 * running it again rather than taking the first number on trust.
 */
export async function countElection(slug: string): Promise<Result<ElectionCount>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");
  if (election.status !== "sealed" && election.status !== "certified")
    return fail(`Ballots must be sealed before they can be counted — this election is "${election.status}".`);

  const { data: sealed } = await db
    .from("election_ballots_sealed")
    .select("abstain, selections")
    .eq("election_id", election.id);

  const candidates = await getBallotCandidates(election);
  const byId = new Map(candidates.map((c) => [c.nominationId, c]));

  const tally = tallyElection(
    (sealed ?? []).map((b) => ({
      selections: (b.selections as string[]) ?? [],
      abstain: b.abstain as boolean,
    })),
    candidates.map((c) => c.nominationId),
    election.seatsAvailable
  );

  // A recorded tie resolution is a HUMAN decision and outranks the recount.
  // Without this, re-counting silently un-elects the candidate the board seated
  // — the tally has no way to know a tie was settled, so it would hand back the
  // same unresolved answer and overwrite the resolution on its way out.
  const { data: resolution } = await db
    .from("election_certifications")
    .select("tie_resolved_at")
    .eq("election_id", election.id)
    .maybeSingle();
  const tieSettled = !!resolution?.tie_resolved_at;

  const { data: storedResults } = tieSettled
    ? await db
        .from("election_results")
        .select("nomination_id, elected")
        .eq("election_id", election.id)
    : { data: null };
  const storedElected = new Map(
    (storedResults ?? []).map((r) => [r.nomination_id as string, r.elected as boolean])
  );

  const results: CountedResult[] = tally.results.map((r) => ({
    nominationId: r.nominationId,
    displayName: byId.get(r.nominationId)?.displayName ?? "Unknown candidate",
    organizationName: byId.get(r.nominationId)?.organizationName ?? "",
    votes: r.votes,
    rank: r.rank,
    elected: tieSettled ? (storedElected.get(r.nominationId) ?? r.elected) : r.elected,
    tiedAtCutoff: r.tiedAtCutoff,
  }));

  for (const r of results) {
    await db.from("election_results").upsert(
      {
        election_id: election.id,
        nomination_id: r.nominationId,
        votes: r.votes,
        rank: r.rank,
        elected: r.elected,
      },
      { onConflict: "election_id,nomination_id" }
    );
  }

  return ok({
    seats: tally.seats,
    ballotsCounted: tally.ballotsCounted,
    abstentions: tally.abstentions,
    blankBallots: tally.blankBallots,
    results,
    tieAtCutoff: tally.tieAtCutoff,
    tiedCandidates: results.filter((r) => r.tiedAtCutoff),
    seatsResolved: tally.seatsResolved,
    certifiable: tally.certifiable || tieSettled,
    tieSettled,
    summary: formatElectionTally(tally),
  });
}

/**
 * Record how a tie was resolved.
 *
 * Kept separate from certification so the resolution and its authority are their
 * own act with their own timestamp. By-Law No. 1 prescribes no tie-break, so
 * whatever is recorded here IS the precedent — it should read like something a
 * future board would be content to be bound by.
 */
export async function recordTieResolution(
  slug: string,
  input: {
    method: "refer_to_agm" | "board_appoints" | "other";
    note: string;
    resolvedByProfileId: string;
    /** Nomination ids that take the remaining seats. */
    electedNominationIds: string[];
  }
): Promise<Result<null>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");
  if (!input.note.trim())
    return fail("Record how the tie was resolved and on what authority — this is the precedent.");

  const counted = await countElection(slug);
  if (!counted.ok) return fail(counted.error);
  if (!counted.data.tieAtCutoff) return fail("There is no tie at the cutoff to resolve.");

  const tied = new Set(counted.data.tiedCandidates.map((c) => c.nominationId));
  for (const id of input.electedNominationIds) {
    if (!tied.has(id))
      return fail("Only candidates tied at the cutoff can be given the remaining seats.");
  }

  const seatsLeft = counted.data.seats - counted.data.seatsResolved;
  if (input.electedNominationIds.length !== seatsLeft)
    return fail(
      `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} remain to be filled, but ${input.electedNominationIds.length} candidate${input.electedNominationIds.length === 1 ? " was" : "s were"} named.`
    );

  // Order matters: the certification row (carrying tie_resolved_at) has to exist
  // BEFORE the elected flags are set, because any countElection that runs in
  // between would recompute the tie and overwrite them.
  await db.from("election_certifications").upsert(
    {
      election_id: election.id,
      ballots_returned: counted.data.ballotsCounted,
      ballots_sealed: counted.data.ballotsCounted,
      reconciled: true,
      tie_at_cutoff: true,
      tie_candidates: counted.data.tiedCandidates.map((c) => c.nominationId),
      tie_resolution_method: input.method,
      tie_resolution_note: input.note.trim(),
      tie_resolved_by_profile_id: input.resolvedByProfileId,
      tie_resolved_at: new Date().toISOString(),
    },
    { onConflict: "election_id" }
  );

  for (const id of input.electedNominationIds) {
    await db
      .from("election_results")
      .update({ elected: true })
      .eq("election_id", election.id)
      .eq("nomination_id", id);
  }

  return ok(null);
}

/**
 * Certify the result.
 *
 * Blocked while a tie at the cutoff has no recorded resolution. That block is
 * the point of the whole tally design: the software will not pick a director,
 * and it will not let anyone certify a result in which it silently did.
 */
export async function certifyElection(
  slug: string,
  input: { certifiedByProfileId: string; scrutineerContactId?: string | null }
): Promise<Result<{ elected: CountedResult[]; reconciled: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");
  if (election.status !== "sealed")
    return fail(`Only a sealed election can be certified — this one is "${election.status}".`);

  const counted = await countElection(slug);
  if (!counted.ok) return fail(counted.error);

  const { data: existing } = await db
    .from("election_certifications")
    .select("tie_resolution_method, tie_resolved_at")
    .eq("election_id", election.id)
    .maybeSingle();

  if (counted.data.tieAtCutoff && !existing?.tie_resolved_at) {
    const names = counted.data.tiedCandidates.map((c) => c.displayName).join(" and ");
    return fail(
      `${names} are tied for the last seat. By-Law No. 1 prescribes no tie-break, so this cannot be certified until someone records how it was resolved and on what authority.`
    );
  }

  const { count: participationCount } = await db
    .from("election_participation")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election.id);

  const reconciled = (participationCount ?? 0) === counted.data.ballotsCounted;

  await db.from("election_certifications").upsert(
    {
      election_id: election.id,
      scrutineer_contact_id: input.scrutineerContactId ?? null,
      ballots_returned: participationCount ?? 0,
      ballots_sealed: counted.data.ballotsCounted,
      reconciled,
      tie_at_cutoff: counted.data.tieAtCutoff,
      tie_candidates: counted.data.tiedCandidates.map((c) => c.nominationId),
      certified_by_profile_id: input.certifiedByProfileId,
      certified_at: new Date().toISOString(),
    },
    { onConflict: "election_id" }
  );

  await db
    .from("elections")
    .update({ status: "certified", updated_at: new Date().toISOString() })
    .eq("id", election.id);

  return ok({ elected: counted.data.results.filter((r) => r.elected), reconciled });
}

export interface AuditView {
  election: Election;
  /** Institutions that returned a ballot. Never how they voted. */
  roll: { organizationName: string; firstCastAt: string; abstained: boolean }[];
  sealedCount: number;
  reconciled: boolean;
  count: ElectionCount | null;
  certification: {
    scrutineerName: string | null;
    certifiedByName: string | null;
    certifiedAt: string | null;
    tieResolutionMethod: string | null;
    tieResolutionNote: string | null;
  } | null;
}

/**
 * What the scrutineer sees.
 *
 * The roll and the totals, and the fact that they reconcile. Deliberately no
 * path from one to the other — after sealing there is none to offer, which is
 * the property the design exists to guarantee rather than merely to promise.
 */
export async function getAuditView(slug: string): Promise<AuditView | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const { data: participation } = await db
    .from("election_participation")
    .select("first_cast_at, abstained, organizations(name)")
    .eq("election_id", election.id)
    .order("first_cast_at");

  const { count: sealedCount } = await db
    .from("election_ballots_sealed")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election.id);

  const counted =
    election.status === "sealed" || election.status === "certified"
      ? await countElection(slug)
      : null;

  const { data: cert } = await db
    .from("election_certifications")
    .select(
      "tie_resolution_method, tie_resolution_note, certified_at, scrutineer_contact_id, certified_by_profile_id, contacts!election_certifications_scrutineer_contact_id_fkey(name), profiles!election_certifications_certified_by_profile_id_fkey(display_name)"
    )
    .eq("election_id", election.id)
    .maybeSingle();

  const roll = (participation ?? []).map((p) => ({
    organizationName: (p.organizations as { name: string } | null)?.name ?? "Unknown institution",
    firstCastAt: p.first_cast_at as string,
    abstained: p.abstained as boolean,
  }));

  return {
    election,
    roll,
    sealedCount: sealedCount ?? 0,
    reconciled: (sealedCount ?? 0) === roll.length,
    count: counted?.ok ? counted.data : null,
    certification: cert
      ? {
          scrutineerName: (cert.contacts as { name: string } | null)?.name ?? null,
          certifiedByName: (cert.profiles as { display_name: string } | null)?.display_name ?? null,
          certifiedAt: (cert.certified_at as string) ?? null,
          tieResolutionMethod: (cert.tie_resolution_method as string) ?? null,
          tieResolutionNote: (cert.tie_resolution_note as string) ?? null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// AGM notices — By-Law Part VII S4(b) and S7(b)
// ---------------------------------------------------------------------------

export interface NoticeState {
  window: ReturnType<typeof resolveNoticeWindow>;
  notice: ReturnType<typeof evaluateNoticeWindow>;
  proxy: ReturnType<typeof evaluateProxyDeadline>;
  noticeSentAt: string | null;
  proxySentAt: string | null;
  /** Eligible member institutions — who notice must reach. */
  recipients: number;
  /** Eligible members with no administrator to give notice to. */
  unreachable: string[];
  /**
   * The meeting's event page, which the notice links to. A draft is invisible
   * to members — getEventBySlug filters on status = 'published' — so notice
   * given while it is a draft carries a dead link. Surfaced here rather than
   * only at send time because the 2027 window has exactly ONE usable day, and
   * discovering this on it would be too late to act.
   */
  eventPage: { slug: string; status: string | null; readyForNotice: boolean };
}

/**
 * `onDate` follows the same convention as `nominationsOpen` above: it defaults
 * to the real clock and exists so the notice window can be evaluated for a date
 * other than today.
 *
 * That is not decoration. The 21-35 day window is the ONE election path that
 * cannot be rehearsed against a scratch election on the real clock: narrowing
 * the electorate to a single institution needs an AGM far enough out that every
 * real membership has lapsed, and the notice window needs an AGM about a month
 * out. Those pull the AGM date roughly a year apart. Being able to pass the date
 * closes that gap without either mailing the whole membership or leaving the
 * legally significant send as the only thing nobody ever ran.
 */
export async function getNoticeState(slug: string, onDate = today()): Promise<NoticeState | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const cfg = election.config as unknown as {
    agmNoticeSentAt?: string;
    proxyFormSentAt?: string;
  };

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const eligible = verdicts.filter((v) => v.isEligible);

  // A member nobody can be reached at is a compliance gap, and it has to be
  // visible while there is still time to fix it — not discovered afterwards.
  const unreachable: string[] = [];
  for (const v of eligible) {
    const { data: admins } = await db
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", v.organizationId)
      .eq("role", "org_admin")
      .eq("status", "active");
    if (!admins?.length) {
      const { data: org } = await db
        .from("organizations")
        .select("name")
        .eq("id", v.organizationId)
        .maybeSingle();
      unreachable.push((org?.name as string) ?? v.organizationId);
    }
  }

  const eventSlug = `csc-annual-general-meeting-${election.cycleYear}`;
  const { data: agmEvent } = await db
    .from("events")
    .select("status")
    .eq("slug", eventSlug)
    .maybeSingle();

  return {
    window: resolveNoticeWindow(election.schedule.agmDate),
    notice: evaluateNoticeWindow(election.schedule.agmDate, onDate),
    proxy: evaluateProxyDeadline(election.schedule.agmDate, onDate),
    noticeSentAt: cfg.agmNoticeSentAt ?? null,
    proxySentAt: cfg.proxyFormSentAt ?? null,
    recipients: eligible.length,
    unreachable,
    eventPage: {
      slug: eventSlug,
      status: (agmEvent?.status as string) ?? null,
      readyForNotice: agmEvent?.status === "published",
    },
  };
}

/**
 * Give notice of the AGM.
 *
 * Refuses outside the 21–35 day window. Outside it the send would not be notice
 * at all — By-Law Part VII S4 is a window, and a notice given on the wrong side
 * of it leaves the meeting improperly called. Sending anyway and noting the
 * problem would produce a record that LOOKS like compliance, which is worse than
 * a refusal somebody has to deal with.
 */
export async function sendAgmNotice(
  slug: string,
  input: {
    sentByProfileId: string;
    agmTime: string;
    location?: string | null;
    /** Send the proxy form in the same run where the dates allow it. */
    includeProxyForm: boolean;
    /** Testing seam only — see getNoticeState. Callers in the app omit it. */
    onDate?: string;
  }
): Promise<Result<{ sent: number; failed: number; problems: string[]; proxyIncluded: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  const state = await getNoticeState(slug, input.onDate ?? today());
  if (!state) return fail("Could not evaluate the notice window.");

  if (state.noticeSentAt)
    return fail(
      `Notice was already given on ${state.noticeSentAt.slice(0, 10)}. Sending again would put a second, contradictory notice in front of every member.`
    );
  if (!state.notice.canSend) return fail(state.notice.message);

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const eligible = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  if (eligible.length === 0)
    return fail("No institutions are currently eligible to vote, so there is nobody to give notice to.");

  // The notice links members to the meeting's event page, and
  // `getEventBySlug` filters on status = 'published' — a draft returns "Event
  // not found". ensureAgmMeetingAndEvent deliberately creates the event as a
  // draft so nothing is announced before a person publishes it, which means the
  // notice would otherwise discharge a Part VII S4(b) obligation with a dead
  // link in it. Publishing the event is part of giving notice, not a separate
  // errand, so this refuses rather than sending something broken.
  const eventSlug = `csc-annual-general-meeting-${election.cycleYear}`;
  const { data: agmEvent } = await db
    .from("events")
    .select("status")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (!agmEvent)
    return fail(
      `There is no event page at /events/${eventSlug} for the notice to point at. The election kickoff creates it.`
    );
  if (agmEvent.status !== "published")
    return fail(
      `The meeting's event page is still a ${agmEvent.status}, so the link in the notice would show members "Event not found". Publish /events/${eventSlug} first — notice with a dead link is defective notice.`
    );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  // Claimed before the send — see sendCallForNominations for why. Notice is the
  // one send where a duplicate is worse than a miss: two notices for the same
  // meeting, possibly stating different times, leave the meeting arguably
  // improperly called under Part VII S4.
  const proxyIncluded = Boolean(input.includeProxyForm && !state.proxySentAt);
  const now = new Date().toISOString();
  await db
    .from("elections")
    .update({
      config: {
        ...(election.config as unknown as Record<string, unknown>),
        agmNoticeSentAt: now,
        agmNoticeSentBy: input.sentByProfileId,
        ...(proxyIncluded ? { proxyFormSentAt: now } : {}),
      },
      updated_at: now,
    })
    .eq("id", election.id);

  const outcomes = await notifyAgmNotice(election, eligible, {
    agmTime: input.agmTime,
    location: input.location ?? null,
    agmUrl: `${appUrl}/events/${eventSlug}`,
  });

  if (proxyIncluded) {
    const proxyOutcomes = await notifyProxyForm(election, eligible, {
      // The appointment page, not the events listing. The old URL pointed at
      // `/events/...#proxy` — an anchor that exists nowhere in the codebase, on
      // an event that is created as a DRAFT. This email discharges a Part VII
      // S7(b) obligation with a 30-day deadline, so it cannot land on a page
      // members are not permitted to see.
      proxyFormUrl: `${appUrl}/elections/${election.slug}/proxy`,
      lateNote: state.proxy.overdue
        ? "This form is being sent later than the by-laws provide for; it remains valid for appointing a proxy."
        : null,
    });
    outcomes.push(...proxyOutcomes);
  }

  const summary = summarizeOutcomes(outcomes);

  return ok({ ...summary, proxyIncluded });
}

/** The proxy form on its own, where it was not sent with the notice. */
export async function sendProxyForm(
  slug: string,
  sentByProfileId: string
): Promise<Result<{ sent: number; failed: number; problems: string[]; wasLate: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  const state = await getNoticeState(slug);
  if (!state) return fail("Could not evaluate the proxy deadline.");
  if (state.proxySentAt)
    return fail(`The proxy form was already sent on ${state.proxySentAt.slice(0, 10)}.`);

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const eligible = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  if (eligible.length === 0) return fail("No institutions are currently eligible to vote.");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  // Claimed before the send — see sendCallForNominations.
  const now = new Date().toISOString();
  await db
    .from("elections")
    .update({
      config: {
        ...(election.config as unknown as Record<string, unknown>),
        proxyFormSentAt: now,
        proxyFormSentBy: sentByProfileId,
      },
      updated_at: now,
    })
    .eq("id", election.id);

  const outcomes = await notifyProxyForm(election, eligible, {
    // The appointment page, not the events listing. The old URL pointed at
    // `/events/...#proxy` — an anchor that exists nowhere in the codebase, on
    // an event that is created as a DRAFT. This email discharges a Part VII
    // S7(b) obligation with a 30-day deadline, so it cannot land on a page
    // members are not permitted to see.
    proxyFormUrl: `${appUrl}/elections/${election.slug}/proxy`,
    lateNote: state.proxy.overdue
      ? "This form is being sent later than the by-laws provide for; it remains valid for appointing a proxy."
      : null,
  });

  return ok({ ...summarizeOutcomes(outcomes), wasLate: state.proxy.overdue });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Officers the board elects each year (By-Law Part VI S1). Past President is not
 * elected — it is held by the previous President — and the Executive Director is
 * staff, so neither appears in the report's list.
 */
const ELECTED_OFFICER_TITLES = ["President", "Vice President", "Secretary", "Treasurer"];

/**
 * Assemble the Nominating Committee Report from the term register and the
 * nominations. Everything factual in the document comes from here; the committee
 * edits prose, not a roster.
 */
export async function getNominatingCommitteeReport(
  slug: string,
  options: { reportDate?: string } = {}
): Promise<ReturnType<typeof buildNominatingCommitteeReport> | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const { data: body } = await db
    .from("governance_bodies")
    .select("seat_count, min_seat_count")
    .eq("id", election.bodyId)
    .maybeSingle();

  // A term ending in the cycle year is up for election; anything later continues.
  const { data: terms } = await db
    .from("governance_role_assignments")
    .select(
      "term_end, person_profile_id, organization_id, profiles:person_profile_id(display_name), organizations:organization_id(name, province)"
    )
    .eq("body_id", election.bodyId)
    .eq("role_key", "director")
    .not("term_end", "is", null);

  const toDirector = (row: {
    profiles: { display_name: string } | null;
    organizations: { name: string; province: string | null } | null;
  }): ReportDirector => ({
    name: row.profiles?.display_name ?? "Unnamed director",
    institution: row.organizations?.name ?? "Institution not recorded",
    region:
      resolveRegion(row.organizations?.province ?? null) === "western"
        ? "Western Region"
        : resolveRegion(row.organizations?.province ?? null) === "eastern"
          ? "Eastern Region"
          : "Region not recorded",
  });

  const continuing: ReportDirector[] = [];
  const completing: ReportDirector[] = [];
  for (const t of terms ?? []) {
    const endYear = Number((t.term_end as string).slice(0, 4));
    const d = toDirector(t as Parameters<typeof toDirector>[0]);
    if (endYear === election.cycleYear) completing.push(d);
    else if (endYear > election.cycleYear) continuing.push(d);
  }

  // Candidates are whoever would reach the ballot as things stand. Before the
  // close that is the live completeness check; after it, the frozen field.
  const nominations = await listNominations(slug);
  const standing = nominations.filter(
    (n) => n.status === "validated" || n.completeness.complete
  );

  const incumbentNames = new Set(completing.map((d) => d.name));
  const candidates: ReportCandidate[] = [];
  for (const n of standing) {
    const { data: org } = await db
      .from("organizations")
      .select("province")
      .eq("id", n.nomineeOrganizationId)
      .maybeSingle();
    const region = resolveRegion((org?.province as string) ?? null);
    candidates.push({
      name: n.nomineeName,
      institution: n.organizationName,
      region:
        region === "western"
          ? "Western Region"
          : region === "eastern"
            ? "Eastern Region"
            : "Region not recorded",
      isIncumbent: incumbentNames.has(n.nomineeName),
    });
  }

  return buildNominatingCommitteeReport({
    cycleYear: election.cycleYear,
    reportDate: options.reportDate ?? today(),
    boardMinSeats: (body?.min_seat_count as number) ?? (body?.seat_count as number) ?? election.seatsAvailable,
    boardMaxSeats: (body?.seat_count as number) ?? election.seatsAvailable,
    seatsAvailable: election.seatsAvailable,
    nominationsCloseOn: election.schedule.nominationsCloseAt,
    nominationFormName: `${election.cycleYear} Board Nomination Form`,
    continuing,
    completing,
    candidates,
    officerTitles: ELECTED_OFFICER_TITLES,
  });
}

/**
 * The times CSC states on every AGM notice and script. Six zones, because the
 * membership spans them and a single "1:00 pm Eastern" makes half the country
 * do arithmetic at seven in the morning.
 */
const CSC_MEETING_TIMES = [
  { label: "Pacific Time", start: "9:00 am", end: "10:00 am" },
  { label: "Mountain Time", start: "10:00 am", end: "11:00 am" },
  { label: "Central Time", start: "11:00 am", end: "12:00 pm" },
  { label: "Eastern Time", start: "12:00 pm", end: "1:00 pm" },
  { label: "Atlantic Time", start: "1:00 pm", end: "2:00 pm" },
  { label: "Newfoundland Time", start: "1:30 pm", end: "2:30 pm" },
];

async function officerNamed(bodyId: string, roleKey: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("governance_role_assignments")
    .select("profiles:person_profile_id(display_name), organizations:organization_id(name)")
    .eq("body_id", bodyId)
    .eq("role_key", roleKey)
    .is("term_end", null)
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    name: (row.profiles as { display_name: string } | null)?.display_name ?? "",
    institution: (row.organizations as { name: string } | null)?.name ?? "",
  };
}

/**
 * Assemble the AGM script.
 *
 * The results section only carries real names once the election has been
 * certified; before that it renders the frame with the roster empty, which is
 * exactly what a script drafted in the autumn looks like.
 */
export async function getAgmScript(
  slug: string,
  options: {
    pollster?: string | null;
    publicAccountant?: string;
    meetingUrl?: string | null;
  } = {}
): Promise<ReturnType<typeof buildAgmScript> | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const [president, treasurer, pastPresident, ed] = await Promise.all([
    officerNamed(election.bodyId, "president"),
    officerNamed(election.bodyId, "treasurer"),
    officerNamed(election.bodyId, "past_president"),
    officerNamed(election.bodyId, "executive_director"),
  ]);

  // The most recent AGM before this one, for the receipt-of-minutes item.
  const { data: prior } = await db
    .from("board_meetings")
    .select("meeting_date")
    .eq("meeting_type", "agm")
    .lt("meeting_date", election.schedule.agmDate)
    .order("meeting_date", { ascending: false })
    .limit(1);

  const report = await getNominatingCommitteeReport(slug);
  const counted =
    election.status === "certified" ? await countElection(slug) : null;

  const elected =
    counted?.ok
      ? counted.data.results
          .filter((r) => r.elected)
          .map((r) => ({ name: r.displayName, institution: r.organizationName }))
      : (report?.sections.find((s) => s.paragraphs[0]?.includes("candidate"))?.roster ?? []).map(
          (d) => ({ name: d.name, institution: d.institution })
        );

  const continuing = (
    report?.sections.find((s) => s.paragraphs[0]?.includes("second year"))?.roster ?? []
  ).map((d) => ({ name: d.name, institution: d.institution }));

  // Departing = completing a term and NOT standing again — which is unknowable
  // until the field is fixed. Before the nomination close, every director whose
  // term ends looks like they are leaving, and generating a farewell tribute for
  // four people who are about to stand for re-election would be quite a thing to
  // hand the Past President.
  const fieldIsFixed =
    election.status === "balloting" ||
    election.status === "nominations_closed" ||
    election.status === "sealed" ||
    election.status === "certified";
  const standingNames = new Set(elected.map((e) => e.name));
  const departing = fieldIsFixed
    ? (report?.sections.find((s) => s.paragraphs[0]?.includes("completing"))?.roster ?? [])
        .filter((d) => !standingNames.has(d.name))
        .map((d) => ({ name: d.name, institution: d.institution }))
    : [];

  const fiscalYearEnd = `${election.cycleYear - 1}-08-31`;

  return buildAgmScript({
    cycleYear: election.cycleYear,
    agmDate: election.schedule.agmDate,
    times: CSC_MEETING_TIMES,
    meetingUrl: options.meetingUrl ?? null,
    priorAgmDate: (prior?.[0]?.meeting_date as string) ?? null,
    chair: {
      name: president?.name ?? "the President",
      institution: president?.institution ?? "",
      role: "President",
    },
    treasurer,
    nominatingChair: pastPresident,
    executiveDirector: ed?.name ?? "the Executive Director",
    pollster: options.pollster ?? null,
    publicAccountant: options.publicAccountant ?? "MNP LLP",
    fiscalYearEnd,
    elected,
    continuing,
    departing,
    acclaimed: election.outcome === "acclaimed",
    officerMeetingNote: null,
  });
}

// ---------------------------------------------------------------------------
// Circulating the ballot
// ---------------------------------------------------------------------------

/**
 * Tell the electorate that voting is open, and chase the ones who have not.
 *
 * Unlike the call for nominations, this is NOT once-only. The association's
 * stated posture is to remind people as often as it takes, so a second press is
 * a legitimate act rather than an accident to guard against. What it must not do
 * is nag somebody who has already voted, so every send after the first goes only
 * to institutions with no ballot on file — and says so in different words, via a
 * different template.
 *
 * Eligibility is re-evaluated at send time rather than reusing whatever was true
 * when balloting opened: a store that renewed yesterday is entitled to vote
 * today, and would otherwise never be told the election was happening.
 */
export async function circulateBallots(
  slug: string,
  sentByProfileId: string
): Promise<
  Result<{
    reminder: boolean;
    institutions: number;
    sent: number;
    failed: number;
    problems: string[];
    skippedAlreadyVoted: number;
  }>
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  if (election.status !== "balloting")
    return fail(
      `Ballots can only be circulated while the election is balloting — this one is "${election.status}".`
    );

  if (phaseOn(election.schedule, today()) !== "balloting")
    return fail(
      `Voting runs ${election.schedule.ballotsOpenAt} to ${election.schedule.ballotsCloseAt}. There is no point sending members to a ballot that is not open.`
    );

  const candidates = await getBallotCandidates(election);
  if (candidates.length === 0)
    return fail("There are no candidates on this ballot, so there is nothing to circulate.");

  const { data: existing } = await db
    .from("elections")
    .select("config")
    .eq("id", election.id)
    .single();
  const config = (existing?.config as Record<string, unknown>) ?? {};
  const previouslyCirculated = Boolean(config.ballotsCirculatedAt);

  const { verdicts } = await evaluateElectionEligibility(election.id);
  let targets = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  const eligibleCount = targets.length;

  if (previouslyCirculated) {
    const { data: voted } = await db
      .from("election_ballots")
      .select("organization_id")
      .eq("election_id", election.id);
    const votedIds = new Set((voted ?? []).map((b) => b.organization_id as string));
    targets = targets.filter((id) => !votedIds.has(id));
  }

  if (targets.length === 0)
    return fail(
      previouslyCirculated
        ? "Every eligible institution has already voted — there is nobody left to remind."
        : "No institutions are currently eligible, so there is nobody to send to."
    );

  // Claimed before the send. This one is re-runnable on purpose — a second
  // press is a REMINDER, and it already excludes anyone who has voted — but
  // only once ballotsCirculatedAt exists. Stamping afterwards meant a send that
  // died part way left no stamp, so the retry was not a reminder at all: it was
  // a second "voting is open" to the entire electorate, including everyone who
  // had already received the first. Claiming first makes the retry do the
  // harmless thing instead of the loud one.
  await db
    .from("elections")
    .update({
      config: {
        ...config,
        ballotsCirculatedAt: new Date().toISOString(),
        ballotsCirculatedBy: sentByProfileId,
        ballotCirculationCount: ((config.ballotCirculationCount as number) ?? 0) + 1,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

  const outcomes = await notifyBallotsOpen(election, targets, {
    candidateCount: candidates.length,
    reminder: previouslyCirculated,
  });
  const summary = summarizeOutcomes(outcomes);

  return ok({
    reminder: previouslyCirculated,
    institutions: targets.length,
    skippedAlreadyVoted: previouslyCirculated ? eligibleCount - targets.length : 0,
    ...summary,
  });
}

/**
 * Save the ballot reminder schedule onto this election.
 *
 * Refuses to store a plan that cannot run, and says why. An incoherent schedule
 * saved quietly is worse than a rejected one: the cron would either skip steps
 * without explanation or fire two nudges into the same afternoon, and the person
 * who set it would have no reason to suspect either.
 *
 * Written onto the ELECTION's config rather than the global default, because
 * that config is the per-cycle snapshot — changing the association's default
 * should not silently re-time a chase that is already under way.
 */
export async function saveReminderSchedule(
  slug: string,
  input: { enabled: boolean; minimumGapDays: number; steps: ReminderStep[] }
): Promise<Result<{ plan: ReminderPlan }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  if (input.steps.length === 0 && input.enabled)
    return fail("Add at least one reminder, or switch reminders off.");

  if (input.minimumGapDays < 0)
    return fail("The minimum gap between reminders cannot be negative.");

  for (const step of input.steps) {
    if (!Number.isInteger(step.daysBeforeClose) || step.daysBeforeClose < 0)
      return fail(`"${step.label || "Untitled"}" needs a whole number of days, zero or more.`);
    if (!step.label.trim()) return fail("Every reminder needs a label, so the log is readable.");
  }

  const candidate: ElectionsConfig = {
    ...election.config,
    reminders: {
      enabled: input.enabled,
      minimumGapDays: input.minimumGapDays,
      steps: input.steps,
    },
  };

  const plan = planReminders(election.schedule, candidate);
  if (plan.problems.length > 0) {
    return fail(`That schedule will not run: ${plan.problems.join(" ")}`);
  }

  const { data: existing } = await db
    .from("elections")
    .select("config")
    .eq("id", election.id)
    .single();

  const { error } = await db
    .from("elections")
    .update({
      config: JSON.parse(
        JSON.stringify({
          ...((existing?.config as Record<string, unknown>) ?? {}),
          reminders: candidate.reminders,
        })
      ) as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

  if (error) return fail(`Could not save the schedule: ${error.message}`);
  return ok({ plan });
}

/** The dated plan for this election, for the admin screen and the cron. */
export async function getReminderPlan(slug: string): Promise<ReminderPlan | null> {
  const election = await getElection(slug);
  if (!election) return null;
  return planReminders(election.schedule, election.config);
}

/**
 * Eligible institutions with no ballot on file — who a "not yet voted" reminder
 * would actually reach. Shown next to the schedule so the admin can see the
 * size of the chase before scheduling it.
 */
export async function countOutstandingBallots(slug: string): Promise<number | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const eligible = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);

  const { data: voted } = await db
    .from("election_ballots")
    .select("organization_id")
    .eq("election_id", election.id);
  const votedIds = new Set((voted ?? []).map((b) => b.organization_id as string));

  return eligible.filter((id) => !votedIds.has(id)).length;
}

/**
 * Fire whichever reminder is due today, across every balloting election.
 *
 * Called daily. Does nothing on a day with no step due, which is most days.
 * The exact-date match in `reminderDueOn` means a missed run is not caught up
 * later — see the note there.
 *
 * Idempotent within a day: the step's label and date are recorded on the
 * election config, so a cron that runs twice does not mail the electorate twice.
 */
export async function runDueBallotReminders(
  onDate?: string
): Promise<
  { slug: string; label: string; institutions: number; sent: number; failed: number }[]
> {
  const db = createAdminClient();
  const today_ = onDate ?? today();
  const fired: {
    slug: string;
    label: string;
    institutions: number;
    sent: number;
    failed: number;
  }[] = [];

  const { data: live } = await db
    .from("elections")
    .select("slug")
    .eq("status", "balloting");

  for (const row of live ?? []) {
    const slug = row.slug as string;
    const election = await getElection(slug);
    if (!election) continue;

    const plan = planReminders(election.schedule, election.config);
    const due = reminderDueOn(plan, today_);
    if (!due) continue;

    const sentLog =
      ((election.config as unknown as { remindersSent?: Record<string, string> })
        .remindersSent ?? {}) as Record<string, string>;
    const key = `${due.sendOn}:${due.label}`;
    if (sentLog[key]) continue;

    const candidates = await getBallotCandidates(election);
    if (candidates.length === 0) continue;

    const { verdicts } = await evaluateElectionEligibility(election.id);
    let targets = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);

    if (due.audience === "not_yet_voted") {
      const { data: voted } = await db
        .from("election_ballots")
        .select("organization_id")
        .eq("election_id", election.id);
      const votedIds = new Set((voted ?? []).map((b) => b.organization_id as string));
      targets = targets.filter((id) => !votedIds.has(id));
    }

    if (targets.length === 0) continue;

    const outcomes = await notifyBallotsOpen(election, targets, {
      candidateCount: candidates.length,
      // Every scheduled step after voting opens is a chase, not an announcement.
      reminder: true,
    });
    const summary = summarizeOutcomes(outcomes);

    const { data: existing } = await db
      .from("elections")
      .select("config")
      .eq("id", election.id)
      .single();

    await db
      .from("elections")
      .update({
        config: JSON.parse(
          JSON.stringify({
            ...((existing?.config as Record<string, unknown>) ?? {}),
            remindersSent: { ...sentLog, [key]: new Date().toISOString() },
          })
        ) as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", election.id);

    fired.push({
      slug,
      label: due.label,
      institutions: targets.length,
      sent: summary.sent,
      failed: summary.failed,
    });
  }

  return fired;
}

// ---------------------------------------------------------------------------
// The members' AGM package
// ---------------------------------------------------------------------------

/**
 * Resolve the AGM package's real state.
 *
 * Reads across three places deliberately: the election (what stage the slate is
 * at), the meeting record (agenda, and the financial statements attached to it),
 * and the PREVIOUS AGM (whose minutes this meeting approves). None of those is
 * the package's owner — the package is a view over all of them.
 */
export async function getAgmPackageState(slug: string): Promise<
  | (AgmPackage & {
      meetingId: string | null;
      financialDocumentId: string | null;
    })
  | null
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const cfg = election.config as unknown as {
    agmNoticeSentAt?: string;
    proxyFormSentAt?: string;
    publicAccountant?: string;
  };

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, agenda_html")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  // The AGM immediately before this one. Its minutes are what this meeting is
  // asked to approve, so they travel with the package.
  const { data: prior } = await db
    .from("board_meetings")
    .select("meeting_date, minutes_html")
    .eq("meeting_type", "agm")
    .lt("meeting_date", election.schedule.agmDate)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let financialDocumentId: string | null = null;
  let financialFilename: string | null = null;
  if (meeting?.id) {
    const { data: fin } = await db
      .from("board_documents")
      .select("id, title, storage_path")
      .eq("meeting_id", meeting.id)
      .eq("document_type", "financials")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fin) {
      financialDocumentId = fin.id as string;
      financialFilename =
        (fin.title as string) ?? (fin.storage_path as string)?.split("/").pop() ?? "Uploaded";
    }
  }

  const candidates = await getBallotCandidates(election);
  const nominationsClosed = !["draft", "nominating"].includes(election.status);

  const pkg = buildAgmPackage({
    cycleYear: election.cycleYear,
    agmDate: election.schedule.agmDate,
    // Matches getAgmScript: CSC's year ends 31 August before the AGM.
    fiscalYearEnd: `${election.cycleYear - 1}-08-31`,
    publicAccountant: cfg.publicAccountant ?? "MNP LLP",
    noticeSentAt: cfg.agmNoticeSentAt ?? null,
    hasAgenda: Boolean(meeting?.agenda_html),
    priorAgmDate: (prior?.meeting_date as string) ?? null,
    hasPriorMinutes: Boolean(prior?.minutes_html),
    financialStatementsFilename: financialFilename,
    nominationsClosed,
    candidateCount: candidates.length,
    outcome: (election.outcome as "acclaimed" | "balloted" | null) ?? null,
    proxyFormSentAt: cfg.proxyFormSentAt ?? null,
  });

  return { ...pkg, meetingId: meeting?.id ?? null, financialDocumentId };
}

/**
 * Attach the reviewed financial statements to the AGM.
 *
 * Stored as a `financials` board document on the meeting rather than anywhere
 * election-specific: the statements belong to the meeting that receives them,
 * and the board-documents bucket and OneDrive sync already understand that
 * shape. Replacing supersedes rather than deletes — a superseded set of
 * statements is a thing an auditor may ask about.
 */
export async function attachFinancialStatements(params: {
  slug: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  uploadedByProfileId: string;
}): Promise<Result<{ documentId: string; replaced: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(params.slug);
  if (!election) return fail("That election does not exist.");

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  if (!meeting?.id)
    return fail("There is no AGM meeting record yet, so there is nothing to attach this to.");

  const safeName = params.filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `${meeting.meeting_date}/financials/${Date.now()}_${safeName}`;

  const { error: uploadError } = await db.storage
    .from("board-documents")
    .upload(storagePath, params.bytes, { contentType: params.contentType, upsert: false });

  if (uploadError) return fail(`Upload failed: ${uploadError.message}`);

  const { data: existing } = await db
    .from("board_documents")
    .select("id")
    .eq("meeting_id", meeting.id)
    .eq("document_type", "financials")
    .maybeSingle();

  const { data: inserted, error } = await db
    .from("board_documents")
    .insert({
      meeting_id: meeting.id,
      title: params.filename,
      document_type: "financials",
      context: "meeting",
      storage_path: storagePath,
      mime_type: params.contentType,
      file_size_bytes: params.bytes.byteLength,
      uploaded_by: params.uploadedByProfileId,
    })
    .select("id")
    .single();

  if (error || !inserted) return fail(`Could not record the document: ${error?.message}`);

  return ok({ documentId: inserted.id as string, replaced: Boolean(existing) });
}

/**
 * The AGM package as a member sees it.
 *
 * Assembled at read time rather than published as a file. Three reasons: the
 * financial statements are a private document that must not become a public URL;
 * the nominating report and candidate statements are generated from live data
 * and would go stale the moment a nominee withdrew; and a page can be revisited,
 * which a 40MB email attachment cannot.
 *
 * The statements are served through a short-lived signed URL generated here,
 * after the caller has been shown to administer an eligible member store. The
 * storage path is never returned — same rule as the partner documents.
 */
export async function getMemberAgmPackage(
  slug: string,
  profileId: string,
  organizations: { organization_id: string; role: string; status: string }[]
): Promise<
  | {
      election: Election;
      organizationName: string | null;
      blocked: string | null;
      noticeSentAt: string | null;
      agendaHtml: string | null;
      priorAgmDate: string | null;
      priorMinutesHtml: string | null;
      financials: { filename: string; url: string } | null;
      report: Awaited<ReturnType<typeof getNominatingCommitteeReport>> | null;
      candidates: BallotCandidate[];
      proxyUrl: string;
    }
  | null
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const actor = await resolveActor(profileId, organizations);

  // The package is member-facing governance material: eligibility to receive it
  // is the same test as eligibility to vote, so a lapsed store is told why
  // rather than shown a blank page.
  let organizationName: string | null = null;
  let blocked: string | null = "You do not administer a member store.";
  for (const orgId of actor.adminOrganizationIds) {
    const verdict = await isOrganizationEligible(election.id, orgId);
    if (verdict?.isEligible) {
      const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
      organizationName = (org?.name as string) ?? null;
      blocked = null;
      break;
    }
    if (verdict?.reason) blocked = verdict.reason;
  }

  const cfg = election.config as unknown as { agmNoticeSentAt?: string };

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, agenda_html")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  const { data: prior } = await db
    .from("board_meetings")
    .select("meeting_date, minutes_html")
    .eq("meeting_type", "agm")
    .lt("meeting_date", election.schedule.agmDate)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let financials: { filename: string; url: string } | null = null;
  if (!blocked && meeting?.id) {
    const { data: fin } = await db
      .from("board_documents")
      .select("title, storage_path")
      .eq("meeting_id", meeting.id)
      .eq("document_type", "financials")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fin?.storage_path) {
      const { data: signed } = await db.storage
        .from("board-documents")
        .createSignedUrl(fin.storage_path as string, 3600);
      if (signed?.signedUrl) {
        financials = {
          filename: (fin.title as string) ?? "Financial statements",
          url: signed.signedUrl,
        };
      }
    }
  }

  const nominationsClosed = !["draft", "nominating"].includes(election.status);

  return {
    election,
    organizationName,
    blocked,
    noticeSentAt: cfg.agmNoticeSentAt ?? null,
    agendaHtml: (meeting?.agenda_html as string) ?? null,
    priorAgmDate: (prior?.meeting_date as string) ?? null,
    priorMinutesHtml: (prior?.minutes_html as string) ?? null,
    financials,
    report: nominationsClosed ? await getNominatingCommitteeReport(slug) : null,
    candidates: election.outcome === "acclaimed" ? [] : await getBallotCandidates(election),
    proxyUrl: `/elections/${slug}/proxy`,
  };
}

/**
 * Send the members' AGM package.
 *
 * An incomplete package can still be sent, and often should be: the statements
 * commonly arrive last, and members are better served by having the agenda and
 * the minutes in December than by receiving everything in January. What is not
 * acceptable is sending it silently incomplete, so the caller must acknowledge
 * what is missing and the email itself tells members what is still to come.
 *
 * Repeatable. Re-sending after the statements land is the expected second use,
 * not an accident to guard against.
 */
export async function sendAgmPackage(
  slug: string,
  sentByProfileId: string,
  opts: { acknowledgedOutstanding: boolean }
): Promise<
  Result<{ institutions: number; sent: number; failed: number; problems: string[]; outstanding: number }>
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  const pkg = await getAgmPackageState(slug);
  if (!pkg) return fail("Could not resolve the package.");

  if (!pkg.complete && !opts.acknowledgedOutstanding) {
    return fail(
      `${pkg.outstanding.length} item${pkg.outstanding.length === 1 ? " is" : "s are"} still outstanding — ${pkg.outstanding
        .map((i) => i.title)
        .join("; ")}. Tick the box to send anyway; members will be told what is still to come.`
    );
  }

  const { verdicts } = await evaluateElectionEligibility(election.id);
  const targets = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  if (targets.length === 0)
    return fail("No institutions are currently eligible, so there is nobody to send to.");

  // Said in the email, in members' terms rather than as an admin checklist.
  // Carries its own <p> tags. The template cannot wrap it, because an empty
  // value inside <p>{{...}}</p> ships a blank paragraph to every member — the
  // same "bake optionality into the value" rule the renewal value clause needed.
  const stillToCome = pkg.complete
    ? ""
    : `<p>Still to come: ${pkg.outstanding
        .map((i) => i.title.charAt(0).toLowerCase() + i.title.slice(1))
        .join("; ")}. We will add ${pkg.outstanding.length === 1 ? "it" : "them"} to the same page as soon as ${pkg.outstanding.length === 1 ? "it arrives" : "they arrive"}.</p>`;

  const outcomes = await notifyAgmPackage(election, targets, { stillToCome });
  const summary = summarizeOutcomes(outcomes);

  const { data: existing } = await db
    .from("elections")
    .select("config")
    .eq("id", election.id)
    .single();

  await db
    .from("elections")
    .update({
      config: JSON.parse(
        JSON.stringify({
          ...((existing?.config as Record<string, unknown>) ?? {}),
          agmPackageSentAt: new Date().toISOString(),
          agmPackageSentBy: sentByProfileId,
          agmPackageSendCount:
            (((existing?.config as Record<string, unknown>)?.agmPackageSendCount as number) ?? 0) + 1,
        })
      ) as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

  return {
    ok: true,
    data: { institutions: targets.length, outstanding: pkg.outstanding.length, ...summary },
  };
}

// ---------------------------------------------------------------------------
// Announcing the result
// ---------------------------------------------------------------------------

/**
 * Build the results announcement from live state.
 *
 * `departing` is the dangerous field. A director completing a term who stands
 * again is NOT departing, and getting it wrong thanks them for their service in
 * the same message that announces their re-election. Computed the same way
 * getAgmScript does: term-enders minus everyone the members just elected.
 */
export async function getResultsAnnouncement(slug: string): Promise<
  | (ResultsAnnouncement & {
      election: Election;
      canSend: boolean;
      blockedReason: string | null;
      meetingHasHappened: boolean;
      recipients: number;
    })
  | null
> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const report = await getNominatingCommitteeReport(slug);
  const counted = election.status === "certified" ? await countElection(slug) : null;

  const elected = (counted?.ok ? counted.data.results.filter((r) => r.elected) : []).map((r) => ({
    name: r.displayName,
    institution: r.organizationName,
  }));

  const rosterFor = (needle: string) =>
    (report?.sections.find((s) => s.paragraphs[0]?.includes(needle))?.roster ?? []).map((d) => ({
      name: d.name,
      institution: d.institution,
    }));

  const electedNames = new Set(elected.map((e) => e.name));
  const departing = rosterFor("completing").filter((d) => !electedNames.has(d.name));

  const { count: ballotsReturned } = await db
    .from("election_participation")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election.id);

  const { summary, verdicts } = await evaluateElectionEligibility(election.id);
  const recipients = verdicts.filter((v) => v.isEligible).length;

  const outcome = (election.outcome as "acclaimed" | "balloted" | null) ?? "balloted";

  const announcement = buildResultsAnnouncement({
    cycleYear: election.cycleYear,
    agmDate: election.schedule.agmDate,
    outcome,
    elected,
    continuing: rosterFor("second year"),
    departing,
    ballotsReturned: outcome === "acclaimed" ? null : (ballotsReturned ?? 0),
    electorateSize: summary.eligible,
    // Two-year terms: a director elected at this AGM serves to the second annual
    // meeting following (By-Law Part IV S2).
    termEndsYear: election.cycleYear + 2,
  });

  // Part V S3(e): the members elect AT the meeting. Before it has happened,
  // nobody has been elected and this message would be false — however finished
  // the count looks.
  const meetingHasHappened = today() >= election.schedule.agmDate;

  let blockedReason: string | null = null;
  if (election.status !== "certified")
    blockedReason = `The result has not been certified — the election is "${election.status}".`;
  else if (announcement.outstanding.length > 0)
    blockedReason = announcement.outstanding.join(" ");

  return {
    ...announcement,
    election,
    meetingHasHappened,
    canSend: blockedReason === null,
    blockedReason,
    recipients,
  };
}

/**
 * Send the result to the membership.
 *
 * Refuses before certification, and refuses before the meeting unless the caller
 * states the meeting has taken place — the AGM date passing is good evidence but
 * not proof, and a postponed meeting would otherwise announce an election that
 * has not happened.
 */
export async function announceResults(
  slug: string,
  sentByProfileId: string,
  opts: { confirmedMeetingHeld: boolean }
): Promise<Result<{ institutions: number; sent: number; failed: number; problems: string[] }>> {
  const db = createAdminClient();
  const state = await getResultsAnnouncement(slug);
  if (!state) return fail("That election does not exist.");
  if (!state.canSend) return fail(state.blockedReason ?? "This cannot be announced yet.");

  if (!state.meetingHasHappened && !opts.confirmedMeetingHeld)
    return fail(
      `The annual general meeting is on ${state.election.schedule.agmDate} and has not happened yet. ` +
        `The members elect at the meeting, so until then nobody has been elected. Confirm the meeting took place to send anyway.`
    );

  const { data: existing } = await db
    .from("elections")
    .select("config")
    .eq("id", state.election.id)
    .single();
  const cfg = (existing?.config as Record<string, unknown>) ?? {};
  if (cfg.resultsAnnouncedAt)
    return fail(
      `The result was already announced on ${String(cfg.resultsAnnouncedAt).slice(0, 10)}. Sending again would tell every member store twice.`
    );

  const { verdicts } = await evaluateElectionEligibility(state.election.id);
  const targets = verdicts.filter((v) => v.isEligible).map((v) => v.organizationId);
  if (targets.length === 0) return fail("No eligible institutions to announce to.");

  const outcomes = await notifyElectionResults(state.election, targets, {
    subject: state.subject,
    html: state.html,
  });
  const summary = summarizeOutcomes(outcomes);

  await db
    .from("elections")
    .update({
      config: JSON.parse(
        JSON.stringify({
          ...cfg,
          resultsAnnouncedAt: new Date().toISOString(),
          resultsAnnouncedBy: sentByProfileId,
        })
      ) as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", state.election.id);

  return ok({ institutions: targets.length, ...summary });
}

/**
 * Generate the members' agenda onto the AGM meeting record.
 *
 * Derived from the same blocks the chair's script uses, so the two cannot drift.
 * Written to `board_meetings.agenda_html`, which is where the package looks and
 * where the meeting's own screens already read from.
 *
 * Refuses to overwrite. An agenda someone has edited by hand is the real one,
 * and silently replacing it with a regenerated version is how a meeting ends up
 * running an order nobody agreed to. Replacing is possible, but it has to be
 * asked for.
 */
export async function generateAgmAgenda(
  slug: string,
  opts: { replace?: boolean; meetingUrl?: string | null } = {}
): Promise<Result<{ meetingId: string; items: number; replaced: boolean }>> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return fail("That election does not exist.");

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, agenda_html")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  if (!meeting?.id)
    return fail("There is no AGM meeting record yet — the election kickoff creates it.");

  const hadAgenda = Boolean(meeting.agenda_html);
  if (hadAgenda && !opts.replace)
    return fail(
      "This meeting already has an agenda. Regenerating would discard whatever has been edited into it — ask for a replacement if that is what you want."
    );

  const script = await getAgmScript(slug, { meetingUrl: opts.meetingUrl ?? null });
  if (!script) return fail("Could not build the meeting script to derive an agenda from.");

  const agenda = buildAgmAgenda({
    cycleYear: election.cycleYear,
    agmDate: election.schedule.agmDate,
    blocks: script.blocks,
    times: CSC_MEETING_TIMES,
    meetingUrl: opts.meetingUrl ?? null,
  });

  const { error } = await db
    .from("board_meetings")
    .update({
      agenda_html: agenda.html,
      agenda_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", meeting.id);

  if (error) return fail(`Could not save the agenda: ${error.message}`);

  return ok({ meetingId: meeting.id as string, items: agenda.items.length, replaced: hadAgenda });
}

/** The cycle as a chronological spine, resolved from live state. */
export async function getElectionTimeline(slug: string): Promise<TimelineStage[] | null> {
  const db = createAdminClient();
  const election = await getElection(slug);
  if (!election) return null;

  const cfg = election.config as unknown as {
    callSentAt?: string;
    ballotsCirculatedAt?: string;
    agmNoticeSentAt?: string;
    proxyFormSentAt?: string;
    agmPackageSentAt?: string;
    resultsAnnouncedAt?: string;
  };

  const notice = await getNoticeState(slug);
  const nominations = await listNominations(slug);
  const validated = nominations.filter((n) => n.completeness.complete).length;
  const { summary } = await evaluateElectionEligibility(election.id);

  const { count: ballotsReturned } = await db
    .from("election_participation")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election.id);

  const { data: cert } = await db
    .from("election_certifications")
    .select("certified_at")
    .eq("election_id", election.id)
    .maybeSingle();

  return buildElectionTimeline(
    {
      cycleYear: election.cycleYear,
      status: election.status,
      outcome: (election.outcome as "acclaimed" | "balloted" | null) ?? null,
      schedule: election.schedule,
      callSentAt: cfg.callSentAt ?? null,
      ballotsCirculatedAt: cfg.ballotsCirculatedAt ?? null,
      noticeSentAt: cfg.agmNoticeSentAt ?? null,
      proxySentAt: cfg.proxyFormSentAt ?? null,
      packageSentAt: cfg.agmPackageSentAt ?? null,
      resultsAnnouncedAt: cfg.resultsAnnouncedAt ?? null,
      certifiedAt: (cert?.certified_at as string) ?? null,
      sealed: ["sealed", "certified"].includes(election.status),
      noticeWindow: notice
        ? {
            opensOn: notice.window.opensOn,
            closesOn: notice.window.closesOn,
            proxyDueOn: notice.window.proxyDueOn,
          }
        : null,
      eventPublished: notice?.eventPage.readyForNotice ?? false,
      nominationsReceived: nominations.length,
      validatedNominees: validated,
      ballotsReturned: ballotsReturned ?? 0,
      electorate: summary.eligible,
    },
    today()
  );
}
