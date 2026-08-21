"use server";

import { revalidatePath } from "next/cache";
import { getServerAuthState } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import {
  submitMemberNomination,
  saveBallot,
  chaseIncompleteNominations,
  sendCallForNominations,
  getElection,
  nominationsOpen,
  acceptNomination,
  declineNomination,
  withdrawNomination,
  signCosignature,
  grantStorePermission,
  requestWithdrawal,
  getNominationByToken,
  getCosignatureByToken,
  resolveActor,
} from "@/lib/elections/service";

type ActionResult = { ok: boolean; error?: string };

/**
 * The nominee accepts, supplying the biography and candidate statement that
 * members will read on the ballot.
 *
 * Authorization is by SESSION, never by possession of the link — the token
 * addresses the nomination, and a nomination email is a forwardable document.
 */
export async function acceptNominationAction(
  token: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to accept this nomination." };

  const result = await acceptNomination(token, auth.user.id, {
    bio: String(formData.get("bio") ?? ""),
    platform: String(formData.get("platform") ?? ""),
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/accept/${token}`);
  return { ok: true };
}

export async function declineNominationAction(token: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to decline this nomination." };

  const result = await declineNomination(token, auth.user.id);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/elections/accept/${token}`);
  return { ok: true };
}

/** Only the nominee may withdraw, however loudly the committee has asked. */
export async function withdrawNominationAction(
  token: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to withdraw." };

  const reason = String(formData.get("reason") ?? "").trim() || null;
  const result = await withdrawNomination(token, auth.user.id, reason);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/elections/accept/${token}`);
  return { ok: true };
}

/**
 * Co-sign on behalf of an institution.
 *
 * The signature belongs to the member store, not the individual, so any active
 * admin of the invited institution may sign for it. That is the only reading
 * consistent with stores that run more than one administrator.
 */
export async function signCosignatureAction(token: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to co-sign." };

  const found = await getCosignatureByToken(token);
  if (!found) return { ok: false, error: "That signing link is not valid." };

  const actor = await resolveActor(auth.user.id, auth.organizations);
  const contactId = actor.contactIdFor(found.organizationId);
  if (!contactId)
    return {
      ok: false,
      error: `You do not have a contact record at ${found.organizationName}, so this signature cannot be attributed.`,
    };

  const result = await signCosignature(token, {
    profileId: auth.user.id,
    contactId,
    organizationIds: actor.adminOrganizationIds,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/cosign/${token}`);
  return { ok: true };
}

/**
 * By-Law Part V S2(d) — the nominee's store permits them to serve. A separate
 * consent from the nominee's own acceptance, and one the nominee cannot give
 * themselves.
 */
export async function grantStorePermissionAction(
  nominationId: string,
  token: string
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to grant permission." };

  const found = await getNominationByToken(token);
  if (!found || found.nomination.id !== nominationId)
    return { ok: false, error: "That nomination could not be found." };

  const actor = await resolveActor(auth.user.id, auth.organizations);
  const contactId = actor.contactIdFor(found.nomination.nomineeOrganizationId);
  if (!contactId)
    return {
      ok: false,
      error: "Only someone with a contact record at the nominee's own institution can grant this.",
    };

  const result = await grantStorePermission(
    nominationId,
    contactId,
    actor.adminOrganizationIds
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/accept/${token}`);
  return { ok: true };
}

/**
 * The nominating committee asking a nominee to step back. Records the ASK only
 * — acting on it stays with the nominee.
 */
export async function requestWithdrawalAction(nominationId: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can make this request." };

  const result = await requestWithdrawal(nominationId, auth.user.id);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/elections");
  return { ok: true };
}


/**
 * Submit a nomination from the membership.
 *
 * Every gate is re-checked server-side at submission, not trusted from the form
 * that was rendered: nominations may have closed while the page sat open, and
 * during a renewal cycle an institution's eligibility can change between
 * loading the form and pressing the button.
 */
export async function submitNominationAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to nominate." };

  const election = await getElection(slug);
  if (!election) return { ok: false, error: "That election does not exist." };
  if (election.status !== "nominating" || !nominationsOpen(election))
    return {
      ok: false,
      error: `Nominations are not open. They run ${election.schedule.nominationsOpenAt} to ${election.schedule.nominationsCloseAt}.`,
    };

  const nomineeContactId = String(formData.get("nomineeContactId") ?? "");
  const nominatorOrganizationId = String(formData.get("nominatorOrganizationId") ?? "");
  const invites = formData.getAll("inviteOrganizationId").map(String).filter(Boolean);

  if (!nomineeContactId) return { ok: false, error: "Choose who you are nominating." };

  const actor = await resolveActor(auth.user.id, auth.organizations);
  if (!actor.adminOrganizationIds.includes(nominatorOrganizationId))
    return { ok: false, error: "You are not an administrator of that institution." };

  const nominatorContactId = actor.contactIdFor(nominatorOrganizationId);
  if (!nominatorContactId)
    return {
      ok: false,
      error: "You have no contact record at that institution, so the nomination could not be attributed.",
    };

  const result = await submitMemberNomination({
    electionSlug: slug,
    nomineeContactId,
    nominator: {
      profileId: auth.user.id,
      contactId: nominatorContactId,
      organizationId: nominatorOrganizationId,
    },
    inviteOrganizationIds: invites,
  });
  if (!result.ok) return { ok: false, error: result.error };

  redirect(`/elections/${slug}/nominate?submitted=${result.data.acceptToken}`);
}


/**
 * Send the call for nominations to every eligible institution.
 *
 * Deliberately a button a person presses on the day, not a cron. The by-law
 * fixes the earliest date, not the latest, and an association gets exactly one
 * first impression of its own election — someone should be looking at the
 * eligibility numbers when this goes out. It also refuses to fire twice.
 */
export async function sendCallForNominationsAction(slug: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can send the call." };

  const result = await sendCallForNominations(slug, auth.user.id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/** Chase every accepted-but-incomplete nomination. Safe to run repeatedly. */
export async function chaseIncompleteAction(slug: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can send reminders." };

  await chaseIncompleteNominations(slug);
  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}


/**
 * Save an institution's ballot.
 *
 * Abstain and selections are mutually exclusive and the service rejects the
 * combination — but the checkbox UI lets someone tick both, so the intent is
 * resolved here: abstaining discards the selections rather than erroring at
 * someone who has plainly said what they meant.
 */
export async function saveBallotAction(slug: string, formData: FormData): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to vote." };

  const organizationId = String(formData.get("organizationId") ?? "");
  const abstain = formData.get("abstain") === "1";
  const selections = abstain ? [] : formData.getAll("selections").map(String).filter(Boolean);

  const result = await saveBallot({
    electionSlug: slug,
    organizationId,
    profileId: auth.user.id,
    organizations: auth.organizations,
    selections,
    abstain,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/${slug}/ballot`);
  return { ok: true };
}


/**
 * Hand the election's obligations to the officers who hold them.
 *
 * Creates board action items, assigned from `governance_role_assignments`, each
 * parented to the last board meeting before its deadline. Idempotent — pressing
 * it twice does not double the board's list.
 */
export async function mintElectionActionItemsAction(slug: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the board can create action items." };

  const { getElection: load } = await import("@/lib/elections/service");
  const { mintElectionActionItems } = await import("@/lib/elections/action-items");

  const election = await load(slug);
  if (!election) return { ok: false, error: "That election does not exist." };

  await mintElectionActionItems(election);
  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}


/**
 * Open an election cycle. The human "yes, start the thing."
 *
 * Deliberately not automatic. Opening an election is a governance act with a
 * date on it, and the seat count has to be confirmed against the term register
 * by someone who has looked — the four/five alternation is not reliable once a
 * seat has been filled mid-term by appointment.
 */
export async function startElectionCycleAction(formData: FormData): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the board or association staff can open an election." };

  const cycleYear = Number(formData.get("cycleYear"));
  const seatsAvailable = Number(formData.get("seatsAvailable"));
  const agmOverride = String(formData.get("agmDateOverride") ?? "").trim() || null;

  if (!Number.isInteger(cycleYear) || cycleYear < 2000)
    return { ok: false, error: "Enter the year the AGM falls in." };
  if (!Number.isInteger(seatsAvailable) || seatsAvailable < 1)
    return { ok: false, error: "Enter how many seats are up for election." };

  const { startElectionCycle } = await import("@/lib/elections/cycle");
  const result = await startElectionCycle({
    cycleYear,
    seatsAvailable,
    startedByProfileId: auth.user.id,
    agmDateOverride: agmOverride,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/elections");
  return { ok: true };
}
