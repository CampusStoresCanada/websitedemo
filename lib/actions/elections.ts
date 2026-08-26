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
    requestBoardCosignature: formData.get("requestBoardCosignature") === "1",
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


async function requireBoard() {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false as const, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false as const, error: "Only the board or association staff can do this." };
  return { ok: true as const, userId: auth.user.id };
}

/**
 * Seal the ballots. Irreversible — the confirmation lives in the UI, and the
 * typed phrase is checked here so a stray click cannot do it.
 */
export async function sealElectionAction(slug: string, formData: FormData): Promise<ActionResult> {
  const guard = await requireBoard();
  if (!guard.ok) return guard;

  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "SEAL")
    return { ok: false, error: 'Type SEAL to confirm. This permanently removes the link between every ballot and the institution that cast it.' };

  const { sealElection } = await import("@/lib/elections/service");
  const result = await sealElection(slug);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}/audit`);
  return {
    ok: true,
    error: result.data.reconciled
      ? undefined
      : `Sealed, but ${result.data.sealed} ballots do not match ${result.data.participation} on the roll. Do not certify until this is understood.`,
  };
}

export async function recordTieResolutionAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const guard = await requireBoard();
  if (!guard.ok) return guard;

  const { recordTieResolution } = await import("@/lib/elections/service");
  const result = await recordTieResolution(slug, {
    method: String(formData.get("method") ?? "refer_to_agm") as "refer_to_agm" | "board_appoints" | "other",
    note: String(formData.get("note") ?? ""),
    resolvedByProfileId: guard.userId,
    electedNominationIds: formData.getAll("elected").map(String).filter(Boolean),
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}/audit`);
  return { ok: true };
}

export async function certifyElectionAction(slug: string, formData: FormData): Promise<ActionResult> {
  const guard = await requireBoard();
  if (!guard.ok) return guard;

  const { certifyElection } = await import("@/lib/elections/service");
  const result = await certifyElection(slug, {
    certifiedByProfileId: guard.userId,
    scrutineerContactId: String(formData.get("scrutineerContactId") ?? "").trim() || null,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}/audit`);
  return { ok: true };
}


/**
 * Give notice of the AGM. The window check lives in the service; this only
 * carries the meeting details a person has to supply.
 */
export async function sendAgmNoticeAction(slug: string, formData: FormData): Promise<ActionResult> {
  const guard = await requireBoard();
  if (!guard.ok) return guard;

  const agmTime = String(formData.get("agmTime") ?? "").trim();
  if (!agmTime)
    return { ok: false, error: "Notice must state the time of the meeting — Part VII S4 requires the time and place." };

  const { sendAgmNotice } = await import("@/lib/elections/service");
  const result = await sendAgmNotice(slug, {
    sentByProfileId: guard.userId,
    agmTime,
    location: String(formData.get("location") ?? "").trim() || null,
    includeProxyForm: formData.get("includeProxyForm") === "1",
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return {
    ok: true,
    error: result.data.problems.length
      ? `Sent to ${result.data.sent}, but ${result.data.failed} did not go: ${result.data.problems.join(" · ")}`
      : undefined,
  };
}

export async function sendProxyFormAction(slug: string): Promise<ActionResult> {
  const guard = await requireBoard();
  if (!guard.ok) return guard;

  const { sendProxyForm } = await import("@/lib/elections/service");
  const result = await sendProxyForm(slug, guard.userId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Appoint a proxyholder for the AGM.
 *
 * Authorization is by session: the caller must administer the store whose vote
 * is being assigned. `appointProxy` re-checks the By-Law Part VII S7 eligibility
 * of the person being appointed, so a tampered form value cannot install an
 * ineligible proxyholder.
 */
export async function appointProxyAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in to appoint a proxy." };

  const organizationId = String(formData.get("organizationId") ?? "");
  const meetingId = String(formData.get("meetingId") ?? "");
  const proxyholderContactId = String(formData.get("proxyholderContactId") ?? "");

  if (!organizationId || !meetingId || !proxyholderContactId) {
    return { ok: false, error: "Choose who will carry your store's vote." };
  }

  const administers = auth.organizations.some(
    (o) => o.organization_id === organizationId && o.role === "org_admin" && o.status === "active"
  );
  if (!administers) {
    return { ok: false, error: "You are not an administrator of that store." };
  }

  const { appointProxy } = await import("@/lib/elections/proxy-service");
  const actor = await resolveActor(auth.user.id, auth.organizations);

  const result = await appointProxy({
    meetingId,
    grantorOrganizationId: organizationId,
    grantorContactId: actor.contactIdFor(organizationId),
    proxyholderContactId,
    formSource: "online",
    actorId: auth.user.id,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/${slug}/proxy`);
  return { ok: true };
}

/**
 * Withdraw a proxy the store has given. Soft — the register keeps the record
 * that an appointment was made and withdrawn.
 */
export async function revokeProxyAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };

  const proxyId = String(formData.get("proxyId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!proxyId) return { ok: false, error: "That proxy could not be identified." };

  const administers = auth.organizations.some(
    (o) => o.organization_id === organizationId && o.role === "org_admin" && o.status === "active"
  );
  if (!administers) {
    return { ok: false, error: "You are not an administrator of that store." };
  }

  const { revokeProxy, getProxyRegister } = await import("@/lib/elections/proxy-service");

  // The proxy must belong to the store the caller administers — otherwise an
  // administrator of any store could withdraw any other store's appointment.
  const meetingId = String(formData.get("meetingId") ?? "");
  const register = await getProxyRegister(meetingId, { includeRevoked: true });
  if (!register.ok) return { ok: false, error: register.error };
  const target = register.data.find((p) => p.id === proxyId);
  if (!target || target.grantorOrganizationId !== organizationId) {
    return { ok: false, error: "That proxy does not belong to your store." };
  }

  const result = await revokeProxy(proxyId, auth.user.id, "Withdrawn by the store");
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/elections/${slug}/proxy`);
  return { ok: true };
}

/**
 * Close nominations and settle the outcome.
 *
 * This is the moment the projection becomes a decision: every accepted
 * nomination is frozen as `validated` or `ineligible`, and the election moves to
 * balloting or to acclamation depending on how many cleared. There is no undo in
 * the UI, so the page states what will happen before it is pressed and the form
 * requires an explicit confirmation.
 *
 * `closeNominations` refuses to run before the published close date. That guard
 * lives in the service rather than here so a future scheduled job closing the
 * window automatically inherits it.
 */
export async function closeNominationsAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can close nominations." };

  if (formData.get("confirm") !== "1") {
    return { ok: false, error: "Tick the confirmation before closing nominations." };
  }

  const { closeNominations } = await import("@/lib/elections/service");
  const result = await closeNominations(slug);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Circulate the ballot, or chase the institutions that have not voted.
 *
 * Repeatable on purpose — the association's posture is to remind as often as it
 * takes. `circulateBallots` decides which of the two it is: the first send goes
 * to every eligible institution, and every send after that goes only to the ones
 * with no ballot on file.
 */
export async function circulateBallotsAction(slug: string): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can circulate ballots." };

  const { circulateBallots } = await import("@/lib/elections/service");
  const result = await circulateBallots(slug, auth.user.id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Save the ballot reminder schedule for one election.
 *
 * Steps arrive as parallel arrays from the form. A row with a blank label is
 * treated as deleted rather than as an error — that is how the admin removes
 * one, and making them press a separate delete button for the same effect would
 * just be ceremony.
 */
export async function saveReminderScheduleAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only the nominating committee can change the reminder schedule." };

  const labels = formData.getAll("label").map(String);
  const days = formData.getAll("daysBeforeClose").map(String);
  const audiences = formData.getAll("audience").map(String);
  const policies = formData.getAll("onNonWorkingDay").map(String);

  const steps = labels
    .map((label, i) => ({
      label: label.trim(),
      daysBeforeClose: Number(days[i] ?? ""),
      audience: (audiences[i] === "everyone" ? "everyone" : "not_yet_voted") as
        | "everyone"
        | "not_yet_voted",
      onNonWorkingDay: (["move_earlier", "move_later", "send_anyway"].includes(policies[i])
        ? policies[i]
        : "move_earlier") as "move_earlier" | "move_later" | "send_anyway",
    }))
    .filter((s) => s.label !== "" && Number.isFinite(s.daysBeforeClose));

  const { saveReminderSchedule } = await import("@/lib/elections/service");
  const result = await saveReminderSchedule(slug, {
    enabled: formData.get("enabled") === "1",
    minimumGapDays: Number(formData.get("minimumGapDays") ?? 2),
    steps,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Upload the reviewed financial statements for the AGM.
 *
 * The one item in the package that nothing in this system can generate — it
 * arrives from the public accountant as a file, and until it does the package
 * cannot go to members.
 */
export async function uploadFinancialStatementsAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only an administrator can attach the financial statements." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Choose the statements file to upload." };

  // The board-documents bucket accepts these; anything else fails at the
  // storage layer with a less helpful message than this one.
  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];
  if (!allowed.includes(file.type))
    return { ok: false, error: `${file.type || "That file type"} cannot be attached — use a PDF, Word or Excel file.` };

  if (file.size > 50 * 1024 * 1024)
    return { ok: false, error: "That file is over the 50MB limit." };

  const { attachFinancialStatements } = await import("@/lib/elections/service");
  const result = await attachFinancialStatements({
    slug,
    filename: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    uploadedByProfileId: auth.user.id,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Send the members' AGM package.
 *
 * Sending while items are outstanding is allowed and often right — the
 * statements commonly arrive last. It just has to be a decision rather than an
 * accident, so the caller acknowledges what is missing and members are told
 * what is still to come.
 */
export async function sendAgmPackageAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only an administrator can send the AGM package." };

  const { sendAgmPackage } = await import("@/lib/elections/service");
  const result = await sendAgmPackage(slug, auth.user.id, {
    acknowledgedOutstanding: formData.get("acknowledgeOutstanding") === "1",
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Announce the election result to the membership.
 *
 * By-Law Part V S3(e): the members elect at the annual general meeting, so this
 * cannot honestly go out before it. The date passing is good evidence the
 * meeting happened but not proof — a postponement would otherwise announce an
 * election that never took place — so the caller confirms.
 */
export async function announceResultsAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only an administrator can announce the result." };

  const { announceResults } = await import("@/lib/elections/service");
  const result = await announceResults(slug, auth.user.id, {
    confirmedMeetingHeld: formData.get("confirmMeetingHeld") === "1",
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}

/**
 * Generate the members' agenda onto the AGM meeting.
 *
 * Refuses to clobber an existing agenda unless `replace` is set — an agenda
 * someone has edited is the real one.
 */
export async function generateAgmAgendaAction(
  slug: string,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false, error: "Only an administrator can generate the agenda." };

  const { generateAgmAgenda } = await import("@/lib/elections/service");
  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim();

  const result = await generateAgmAgenda(slug, {
    replace: formData.get("replace") === "1",
    meetingUrl: meetingUrl || null,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/elections/${slug}`);
  return { ok: true };
}
