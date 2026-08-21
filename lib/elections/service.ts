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
import { getProgramsConfig } from "@/lib/policy/engine";
import { resolveMembershipStatus } from "@/lib/auth/org-level";
import {
  resolveElectionsConfig,
  type ElectionsConfig,
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
  type CosignatureStatus,
  type CandidateEligibility,
} from "./nomination";
import { deriveSchedule, phaseOn, type ElectionSchedule } from "./schedule";
import {
  buildRepresentationSnapshot,
  type OrgProfile,
  type RepresentationSnapshot,
} from "./representation";
import { resolveOutcome } from "./tally";
import { validateBallot, orderCandidates } from "./ballot";
import {
  notifyNominee,
  notifyCosigners,
  notifyStorePermission,
  notifyNominationReady,
  notifyNominationIncomplete,
  notifyCallForNominations,
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

  const eligibility = await isOrganizationEligible(
    election.id,
    n.nominee_organization_id as string
  );

  const candidate = evaluateCandidateEligibility(
    {
      contactId: n.nominee_contact_id as string,
      displayName: nomineeName,
      organizationId: n.nominee_organization_id as string,
      isMemberStoreEmployee: eligibility?.isEligible ?? false,
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

  // The nominee's institution must itself be eligible. Checked live rather than
  // against a stored verdict, because a renewal completed this morning counts.
  const orgVerdict = await isOrganizationEligible(election.id, input.nomineeOrganizationId);
  if (!orgVerdict?.isEligible)
    return fail(orgVerdict?.reason ?? "The nominee's institution is not eligible to put a candidate forward.");

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

  const cosignTokens: { organizationId: string; token: string }[] = [];
  for (const c of input.cosignerOrganizationIds ?? []) {
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

  // The signing institution must itself be a member in good standing — a lapsed
  // store's signature would not carry the support the by-law is asking for.
  const orgVerdict = await isOrganizationEligible(election.id, sig.organization_id as string);
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

  const outcomes = await notifyCallForNominations(election, eligible);
  const summary = summarizeOutcomes(outcomes);

  await db
    .from("elections")
    .update({
      config: {
        ...(existing?.config as Record<string, unknown>),
        callSentAt: new Date().toISOString(),
        callSentBy: sentByProfileId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", election.id);

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
