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
  const outcomes: NotifyOutcome[] = [];

  for (const invite of invitations) {
    const contact = await loadContact(invite.contactId);
    const { data: org } = await db
      .from("organizations")
      .select("name")
      .eq("id", invite.organizationId)
      .maybeSingle();

    outcomes.push(
      await send("election_cosign_request", contact?.email, {
        contact_name: contact?.name ?? "there",
        organization_name: (org?.name as string) ?? "your institution",
        nominee_name: nominee.name,
        nominee_org: nominee.organizationName,
        cosign_url: `${appUrl()}/elections/cosign/${invite.token}`,
        nominations_close: formatDate(election.schedule.nominationsCloseAt),
      })
    );
  }
  return outcomes;
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
  const outcomes: NotifyOutcome[] = [];
  for (const orgId of organizationIds) {
    const admins = await loadOrgAdminContacts(orgId);
    for (const admin of admins) {
      outcomes.push(
        await send("election_call_for_nominations", admin.email, {
          contact_name: admin.name,
          cycle_year: election.cycleYear,
          seats_available: election.seatsAvailable,
          agm_date: formatDate(election.schedule.agmDate),
          nominations_close: formatDate(election.schedule.nominationsCloseAt),
          nominate_url: `${appUrl()}/elections/${election.slug}/nominate`,
        })
      );
    }
  }
  return outcomes;
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
