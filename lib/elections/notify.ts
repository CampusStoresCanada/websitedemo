/**
 * Election email.
 *
 * Every send here is TRANSACTIONAL under CASL and the templates are flagged as
 * such, which means they bypass `comms_suppressions`. That is deliberate and
 * worth being explicit about: a nomination is not a commercial electronic
 * message, and a member who once unsubscribed from conference marketing must
 * still be told they have been nominated. Being unable to receive your own
 * nomination is disenfranchisement by mailing-list preference.
 *
 * The cost of that choice is that a dead address is also not filtered out. We
 * cannot currently detect one — Resend delivery events have never reached the
 * webhook, so `comms_suppressions` holds unsubscribes only and bounce
 * auto-suppression is not functioning. So this module returns a per-recipient
 * outcome for every send and the callers surface it, rather than assuming that
 * "no error" means "it arrived". For an election the honest position is: we
 * know what we attempted, not what landed.
 *
 * Nothing here throws. An election action must never fail because an email
 * failed — the record is the database, and the email is a notification of it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateKey } from "@/lib/comms/types";
import type { Election } from "./service";

export interface NotifyOutcome {
  template: string;
  to: string;
  sent: boolean;
  error?: string;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Hard off-switch, checked at the single point every election email passes
 * through.
 *
 * The end-to-end check exercises the real submission path using real member
 * institutions as co-signers, which means it addresses real administrators. It
 * relies on this rather than on `DEV_EMAIL_INTERCEPT` being set, because the
 * intercept is an environment setting that a CI box or a colleague's machine
 * may not have — and "did not email 40 campus stores" is not a property to
 * leave to configuration.
 */
function emailSuppressed(): boolean {
  return process.env.ELECTIONS_SUPPRESS_EMAIL === "1";
}

async function send(
  templateKey: TemplateKey,
  to: string | null | undefined,
  variables: Record<string, string | number | null | undefined>
): Promise<NotifyOutcome> {
  if (emailSuppressed()) {
    return { template: templateKey, to: to ?? "", sent: false, error: "suppressed" };
  }
  if (!to?.trim()) {
    // A contact with no email is a real and common state. Reporting it beats
    // pretending the message went out.
    return { template: templateKey, to: "", sent: false, error: "No email address on record." };
  }
  try {
    // Imported here, not at module scope: `lib/comms/send` constructs a Resend
    // client on load and throws without an API key, which would make this
    // module — and everything importing the election service — unloadable in a
    // test run or any environment that does not send mail. A suppressed run now
    // never touches Resend at all.
    const { sendTransactional } = await import("@/lib/comms/send");
    const result = await sendTransactional({ templateKey, to, variables });
    return { template: templateKey, to, sent: result.success, error: result.error };
  } catch (err) {
    return {
      template: templateKey,
      to,
      sent: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  }
}

/**
 * The many-recipient form of `send`, with the same guarantees.
 *
 * Every election broadcast goes through here rather than awaiting `send` in a
 * loop. Suppression is still checked once at the top, contacts with no email
 * are still reported rather than silently dropped, and the outcome array is
 * still one entry per intended recipient in the order given — callers and
 * `summarizeOutcomes` see no difference. What changes is that the messages
 * leave in one request per hundred instead of one request each.
 */
async function sendMany(
  templateKey: TemplateKey,
  recipients: { to: string | null | undefined; variables: Record<string, string | number | null | undefined> }[]
): Promise<NotifyOutcome[]> {
  if (emailSuppressed()) {
    return recipients.map((r) => ({
      template: templateKey, to: r.to ?? "", sent: false, error: "suppressed",
    }));
  }

  // Addressable and unaddressable are separated so a contact with no email on
  // record is reported as exactly that, not folded into a delivery failure.
  const outcomes: NotifyOutcome[] = new Array(recipients.length);
  const sendable: { index: number; to: string; variables: Record<string, string | number | null | undefined> }[] = [];
  recipients.forEach((r, index) => {
    if (!r.to?.trim()) {
      outcomes[index] = {
        template: templateKey, to: "", sent: false,
        error: "No email address on record.",
      };
      return;
    }
    sendable.push({ index, to: r.to, variables: r.variables });
  });

  if (sendable.length === 0) return outcomes;

  try {
    // Imported here for the same reason as in `send`: lib/comms/send builds a
    // Resend client on load and throws without an API key.
    const { sendTransactionalBatch } = await import("@/lib/comms/send");
    const results = await sendTransactionalBatch({
      templateKey,
      recipients: sendable.map((r) => ({ to: r.to, variables: r.variables })),
    });
    sendable.forEach((r, i) => {
      outcomes[r.index] = {
        template: templateKey, to: r.to,
        sent: results[i]?.success ?? false,
        error: results[i]?.error,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed.";
    for (const r of sendable) {
      outcomes[r.index] = { template: templateKey, to: r.to, sent: false, error: message };
    }
  }

  return outcomes;
}

interface ContactRow {
  id: string;
  email: string | null;
  name: string;
}

async function loadContact(contactId: string): Promise<ContactRow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("contacts")
    .select("id, email, name, first_name, last_name")
    .eq("id", contactId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    email: (data.email as string) ?? null,
    name:
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      (data.name as string) ||
      "there",
  };
}

/** The institution's own name, for copy that addresses the store rather than the reader. */
async function loadOrgName(organizationId: string): Promise<string> {
  const db = createAdminClient();
  const { data } = await db
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  return (data?.name as string) ?? "Your institution";
}

/**
 * Admins at an institution, excluding one person.
 *
 * Used for the store-permission request, where the one person who must NOT be
 * asked is the nominee themselves — By-Law Part V S2(d) is the institution's
 * consent, and a nominee granting their own would make it meaningless.
 */
async function loadOrgAdminContacts(
  organizationId: string,
  excludeContactId?: string
): Promise<ContactRow[]> {
  const db = createAdminClient();
  const { data: admins } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "org_admin")
    .eq("status", "active");

  const userIds = (admins ?? []).map((a) => a.user_id as string);
  if (userIds.length === 0) return [];

  const { data } = await db
    .from("contacts")
    .select("id, email, name, first_name, last_name")
    .eq("organization_id", organizationId)
    .in("profile_id", userIds);

  return (data ?? [])
    .filter((c) => c.id !== excludeContactId)
    .map((c) => ({
      id: c.id as string,
      email: (c.email as string) ?? null,
      name:
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        (c.name as string) ||
        "there",
    }));
}

/** Tells a nominee they have been nominated, and carries the acceptance link. */
export async function notifyNominee(
  election: Election,
  nomination: { id: string; acceptToken: string; nomineeContactId: string; nomineeOrganizationName: string },
  nominatorOrgName: string
): Promise<NotifyOutcome> {
  const nominee = await loadContact(nomination.nomineeContactId);
  return send("election_nomination_received", nominee?.email, {
    nominee_name: nominee?.name ?? "there",
    nominator_org: nominatorOrgName,
    organization_name: nomination.nomineeOrganizationName,
    cycle_year: election.cycleYear,
    accept_url: `${appUrl()}/elections/accept/${nomination.acceptToken}`,
    nominations_close: formatDate(election.schedule.nominationsCloseAt),
  });
}

/** Asks each invited institution to co-sign. */
export async function notifyCosigners(
  election: Election,
  nominee: { name: string; organizationName: string },
  invitations: { organizationId: string; contactId: string; token: string }[]
): Promise<NotifyOutcome[]> {
  const db = createAdminClient();

  // Usually two, but requestBoardCosignature invites every sitting director as
  // well — so this fans out to a dozen people on a nomination that asked the
  // board for help, not the two the by-law's minimum implies.
  const resolved = await Promise.all(
    invitations.map(async (invite) => {
      const [contact, orgRow] = await Promise.all([
        loadContact(invite.contactId),
        db.from("organizations").select("name").eq("id", invite.organizationId).maybeSingle(),
      ]);
      return { invite, contact, organizationName: (orgRow.data?.name as string) ?? "your institution" };
    })
  );

  return sendMany(
    "election_cosign_request",
    resolved.map(({ invite, contact, organizationName }) => ({
      to: contact?.email,
      variables: {
        contact_name: contact?.name ?? "there",
        organization_name: organizationName,
        nominee_name: nominee.name,
        nominee_org: nominee.organizationName,
        cosign_url: `${appUrl()}/elections/cosign/${invite.token}`,
        nominations_close: formatDate(election.schedule.nominationsCloseAt),
      },
    }))
  );
}

/**
 * Asks the nominee's own institution for permission to serve.
 *
 * Goes to every admin there except the nominee. Sending to all of them rather
 * than picking one is deliberate — the permission belongs to the institution,
 * and a single named recipient who is on leave stalls the nomination silently.
 */
export async function notifyStorePermission(
  election: Election,
  nomination: { acceptToken: string; nomineeContactId: string; nomineeOrganizationId: string }
): Promise<NotifyOutcome[]> {
  const nominee = await loadContact(nomination.nomineeContactId);
  const admins = await loadOrgAdminContacts(
    nomination.nomineeOrganizationId,
    nomination.nomineeContactId
  );

  if (admins.length === 0) {
    // The nominee is the only administrator at their own store, so nobody there
    // can grant permission. Not an error to swallow — the committee has to know,
    // because this nomination cannot complete on its own.
    return [
      {
        template: "election_store_permission_request",
        to: "",
        sent: false,
        error:
          "No other administrator at the nominee's institution can grant permission to serve. Someone else there needs an account, or the Executive Director has to record it.",
      },
    ];
  }

  const outcomes: NotifyOutcome[] = [];
  for (const admin of admins) {
    outcomes.push(
      await send("election_store_permission_request", admin.email, {
        contact_name: admin.name,
        nominee_name: nominee?.name ?? "your colleague",
        agm_date: formatDate(election.schedule.agmDate),
        permission_url: `${appUrl()}/elections/accept/${nomination.acceptToken}`,
        nominations_close: formatDate(election.schedule.nominationsCloseAt),
      })
    );
  }
  return outcomes;
}

/** Confirms to the nominee that nothing further is outstanding. */
export async function notifyNominationReady(
  election: Election,
  nomination: {
    acceptToken: string;
    nomineeContactId: string;
    nomineeOrganizationName: string;
  }
): Promise<NotifyOutcome> {
  const nominee = await loadContact(nomination.nomineeContactId);
  return send("election_nomination_ready", nominee?.email, {
    nominee_name: nominee?.name ?? "there",
    organization_name: nomination.nomineeOrganizationName,
    nominations_close: formatDate(election.schedule.nominationsCloseAt),
    accept_url: `${appUrl()}/elections/accept/${nomination.acceptToken}`,
    ballots_open: formatDate(election.schedule.ballotsOpenAt),
  });
}

/** Chases a nomination that is accepted but still short of something. */
export async function notifyNominationIncomplete(
  election: Election,
  nomination: { acceptToken: string; nomineeContactId: string },
  outstanding: string[]
): Promise<NotifyOutcome> {
  const nominee = await loadContact(nomination.nomineeContactId);
  const items = outstanding.map((o) => `<li>${escapeHtml(o)}</li>`).join("");
  return send("election_nomination_incomplete", nominee?.email, {
    nominee_name: nominee?.name ?? "there",
    nominations_close: formatDate(election.schedule.nominationsCloseAt),
    outstanding_html: `<ul>${items}</ul>`,
    accept_url: `${appUrl()}/elections/accept/${nomination.acceptToken}`,
  });
}

/** The call for nominations, to every eligible institution's administrators. */
export async function notifyCallForNominations(
  election: Election,
  organizationIds: string[]
): Promise<NotifyOutcome[]> {
  // Resolve every recipient first, then send once. The institutions are read
  // in parallel because each is an independent lookup.
  const perOrg = await Promise.all(organizationIds.map((id) => loadOrgAdminContacts(id)));
  const admins = perOrg.flat();

  return sendMany(
    "election_call_for_nominations",
    admins.map((admin) => ({
      to: admin.email,
      variables: {
        contact_name: admin.name,
        cycle_year: election.cycleYear,
        seats_available: election.seatsAvailable,
        agm_date: formatDate(election.schedule.agmDate),
        nominations_close: formatDate(election.schedule.nominationsCloseAt),
        nominate_url: `${appUrl()}/elections/${election.slug}/nominate`,
      },
    }))
  );
}

/** Variables are member-supplied in places; never interpolate them raw. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function summarizeOutcomes(outcomes: NotifyOutcome[]): {
  sent: number;
  failed: number;
  problems: string[];
} {
  const failed = outcomes.filter((o) => !o.sent);
  return {
    sent: outcomes.length - failed.length,
    failed: failed.length,
    problems: failed.map((o) => `${o.template}${o.to ? ` → ${o.to}` : ""}: ${o.error ?? "unknown"}`),
  };
}

// ---------------------------------------------------------------------------
// AGM notices — By-Law Part VII
// ---------------------------------------------------------------------------

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Notice of the annual general meeting, to every member entitled to vote.
 *
 * "Each member entitled to vote" is the institution, and the people who can act
 * for it are its administrators — the same audience as the call for nominations.
 * Sending to every administrator rather than one named contact is deliberate:
 * notice that lands with someone on leave has not reached the member.
 */
export async function notifyAgmNotice(
  election: Election,
  organizationIds: string[],
  details: { agmTime: string; location: string | null; agmUrl: string }
): Promise<NotifyOutcome[]> {
  const db = createAdminClient();

  const perOrg = await Promise.all(
    organizationIds.map(async (orgId) => {
      const [orgRow, admins] = await Promise.all([
        db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
        loadOrgAdminContacts(orgId),
      ]);
      return { orgId, organizationName: (orgRow.data?.name as string) ?? null, admins };
    })
  );

  // A member with nobody to give notice to is a compliance problem, not a send
  // failure — it must be visible before the window closes, so it is reported
  // whether or not anything was dispatched.
  const unreachable: NotifyOutcome[] = perOrg
    .filter((o) => o.admins.length === 0)
    .map((o) => ({
      template: "agm_notice_of_meeting" as TemplateKey,
      to: "",
      sent: false,
      error: `${o.organizationName ?? o.orgId} has no administrator to give notice to. Notice cannot be given to this member electronically.`,
    }));

  const sent = await sendMany(
    "agm_notice_of_meeting",
    perOrg.flatMap((o) =>
      o.admins.map((admin) => ({
        to: admin.email,
        variables: {
          contact_name: admin.name,
          organization_name: o.organizationName ?? "your institution",
          cycle_year: election.cycleYear,
          agm_date: election.schedule.agmDate,
          agm_date_long: formatLongDate(election.schedule.agmDate),
          agm_time: details.agmTime,
          // The renderer has no inline conditionals the transactional path can
          // reach ({{#if}} needs a flags map it does not pass), so optionality
          // is baked into the value rather than the template.
          location_clause: details.location ? `, ${details.location}` : "",
          seats_available: election.seatsAvailable,
          agm_url: details.agmUrl,
        },
      }))
    )
  );

  return [...unreachable, ...sent];
}

/** The proxy form. Separate obligation, separate date — Part VII S7(b). */
export async function notifyProxyForm(
  election: Election,
  organizationIds: string[],
  details: { proxyFormUrl: string; lateNote?: string | null }
): Promise<NotifyOutcome[]> {
  const db = createAdminClient();

  const perOrg = await Promise.all(
    organizationIds.map(async (orgId) => {
      const [orgRow, admins] = await Promise.all([
        db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
        loadOrgAdminContacts(orgId),
      ]);
      const organizationName = (orgRow.data?.name as string) ?? "your institution";
      return admins.map((admin) => ({ admin, organizationName }));
    })
  );

  return sendMany(
    "agm_proxy_form",
    perOrg.flat().map(({ admin, organizationName }) => ({
      to: admin.email,
      variables: {
        contact_name: admin.name,
        organization_name: organizationName,
        cycle_year: election.cycleYear,
        agm_date_long: formatLongDate(election.schedule.agmDate),
        proxy_form_url: details.proxyFormUrl,
        late_note: details.lateNote ?? null,
      },
    }))
  );
}

/**
 * Ballots are open — go to the site and vote.
 *
 * Every other election email in this module carries a token, because it
 * addresses one record: a nomination to accept, a co-signature to sign. The
 * ballot deliberately does not.
 *
 * A ballot belongs to the INSTITUTION, and any of its administrators may open
 * and revise it. A token in an email would therefore be a bearer credential for
 * a store's entire vote — forward the message, or have it sit in a shared inbox,
 * and somebody else can cast it. So this mails a plain URL and lets the session
 * decide: an administrator who is signed in lands on the ballot, and anyone else
 * is asked to sign in first. That is a small amount of friction bought with a
 * real guarantee, and the copy says so rather than leaving the reader to wonder
 * why voting needs a login.
 *
 * `reminder` swaps the template for the chase sent to stores that have not voted.
 * Two templates rather than one with a conditional: this renderer's only
 * conditional is `{{#if}}` against a flags map that sendTransactional does not
 * pass, so a branch inside the body would ship to members as literal text.
 */
export async function notifyBallotsOpen(
  election: Election,
  organizationIds: string[],
  opts: { candidateCount: number; reminder?: boolean }
): Promise<NotifyOutcome[]> {
  const templateKey = opts.reminder ? "election_ballot_reminder" : "election_ballots_open";

  const perOrg = await Promise.all(
    organizationIds.map(async (orgId) => {
      const [admins, organizationName] = await Promise.all([
        loadOrgAdminContacts(orgId),
        loadOrgName(orgId),
      ]);
      return admins.map((admin) => ({ admin, organizationName }));
    })
  );

  return sendMany(
    templateKey,
    perOrg.flat().map(({ admin, organizationName }) => ({
      to: admin.email,
      variables: {
        contact_name: admin.name,
        organization_name: organizationName,
        cycle_year: election.cycleYear,
        candidate_count: opts.candidateCount,
        seats_available: election.seatsAvailable,
        agm_date: formatDate(election.schedule.agmDate),
        ballots_close: formatDate(election.schedule.ballotsCloseAt),
        ballot_url: `${appUrl()}/elections/${election.slug}/ballot`,
      },
    }))
  );
}

/**
 * The members' AGM package is ready — come and read it.
 *
 * Like the ballot, this carries no token and no attachment. The financial
 * statements are members-only and would become a public URL the moment they
 * were linked directly; the package page serves them through a short-lived
 * signed URL after the session has been checked.
 *
 * `stillToCome` is baked into a variable rather than a conditional block: this
 * renderer's only branch is `{{#if}}` against a flags map sendTransactional does
 * not pass, so a conditional in the body would reach members as literal text.
 * An empty string renders as nothing, which is the honest default when the
 * package is complete.
 */
export async function notifyAgmPackage(
  election: Election,
  organizationIds: string[],
  opts: { stillToCome: string }
): Promise<NotifyOutcome[]> {
  const perOrg = await Promise.all(
    organizationIds.map(async (orgId) => {
      const [admins, organizationName] = await Promise.all([
        loadOrgAdminContacts(orgId),
        loadOrgName(orgId),
      ]);
      return admins.map((admin) => ({ admin, organizationName }));
    })
  );

  return sendMany(
    "agm_package_available",
    perOrg.flat().map(({ admin, organizationName }) => ({
      to: admin.email,
      variables: {
        contact_name: admin.name,
        organization_name: organizationName,
        cycle_year: election.cycleYear,
        agm_date: formatDate(election.schedule.agmDate),
        package_url: `${appUrl()}/elections/${election.slug}/package`,
        still_to_come: opts.stillToCome,
      },
    }))
  );
}

/**
 * The result, after the annual general meeting has elected the board.
 *
 * The body is generated whole by buildResultsAnnouncement and passed in as one
 * variable. That is deliberate: the wording turns on the by-law's split between
 * announcing and electing, on acclamation versus ballot, and on who actually
 * departed — none of which a template with placeholders could get right, and all
 * of which is covered by tests where it lives.
 */
export async function notifyElectionResults(
  election: Election,
  organizationIds: string[],
  announcement: { subject: string; html: string }
): Promise<NotifyOutcome[]> {
  const perOrg = await Promise.all(
    organizationIds.map(async (orgId) => {
      const [admins, organizationName] = await Promise.all([
        loadOrgAdminContacts(orgId),
        loadOrgName(orgId),
      ]);
      return admins.map((admin) => ({ admin, organizationName }));
    })
  );

  return sendMany(
    "election_results_announced",
    perOrg.flat().map(({ admin, organizationName }) => ({
      to: admin.email,
      variables: {
        contact_name: admin.name,
        organization_name: organizationName,
        subject_line: announcement.subject,
        heading: `Your ${election.cycleYear} Board of Directors`,
        announcement_html: announcement.html,
      },
    }))
  );
}
