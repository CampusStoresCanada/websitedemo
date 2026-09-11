/**
 * Every message this cycle sends, resolved with THIS election's real values.
 *
 * The admin screens needed two things Greg asked for after using the console:
 * see what a member will actually receive, and send himself a test before it
 * goes to fifty stores. Both need the variables filled in — a preview of
 * "Nominations are open for the {{cycle_year}} CSC Board" with the braces
 * still showing answers nothing.
 *
 * ⛔ The variables here are NOT rebuilt for the preview. Each entry calls the
 * same `build*` resolver that the real send calls, and takes the first
 * recipient's values. A preview with its own copy of the variable maps would
 * drift from the send the first time either changed, and a preview that lies
 * about what members receive is worse than no preview — it gets believed.
 */

import { getTemplate } from "@/lib/comms/templates";
import { renderTemplateContent } from "@/lib/comms/templates";
import type { MessageTemplate, TemplateKey } from "@/lib/comms/types";
import type { Election } from "./service";
import {
  buildCallForNominations,
  buildBallotsOpen,
  buildProxyForm,
  buildAgmNotice,
  buildAgmPackage,
  buildElectionResults,
  type PreparedMessages,
} from "./notify";

export interface ElectionMessage {
  key: string;
  /** Where in the cycle this one goes out. */
  stage: string;
  /** What the committee calls it. */
  label: string;
  templateKey: TemplateKey;
  /** Null when the template row is missing — the send would fail, so say so. */
  templateId: string | null;
  missingTemplate: boolean;
  isTransactional: boolean;
  subject: string;
  bodyHtml: string;
  variableKeys: string[];
  /** This election's real values, keyed as the template expects. */
  variables: Record<string, string>;
  /** How many people this would reach right now. */
  recipientCount: number;
  /** Rendered with the real values, for display without opening anything. */
  renderedSubject: string;
  /** Set when nothing could be resolved — an empty electorate, usually. */
  note: string | null;
}

/** Variables as strings, which is what the preview and test-send routes take. */
function stringify(
  vars: Record<string, string | number | null | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
  );
}

/**
 * A stand-in recipient, used only when the electorate is currently empty —
 * before renewals land, `board-2027` really does resolve to nobody. Clearly
 * labelled rather than invented so nobody mistakes it for a real member.
 */
const SAMPLE = {
  contact_name: "[a member's name]",
  organization_name: "[their institution]",
};

async function describe(
  prepared: PreparedMessages,
  meta: { key: string; stage: string; label: string; note?: string | null }
): Promise<ElectionMessage> {
  const template: MessageTemplate | null = await getTemplate(prepared.templateKey);
  const first = prepared.recipients[0];
  const variables = stringify({ ...SAMPLE, ...(first?.variables ?? {}) });

  const rendered = template
    ? renderTemplateContent(template, { app_url: process.env.NEXT_PUBLIC_APP_URL ?? "", ...variables })
    : { subject: "", bodyHtml: "" };

  return {
    key: meta.key,
    stage: meta.stage,
    label: meta.label,
    templateKey: prepared.templateKey,
    templateId: template?.id ?? null,
    missingTemplate: !template,
    isTransactional: template?.is_transactional ?? true,
    subject: template?.subject ?? "",
    bodyHtml: template?.body_html ?? "",
    variableKeys: template?.variable_keys ?? Object.keys(variables),
    variables,
    recipientCount: prepared.recipients.length,
    renderedSubject: rendered.subject,
    note:
      meta.note ??
      (prepared.recipients.length === 0
        ? "No institution is eligible right now, so this is shown with placeholder values."
        : null),
  };
}

export async function getElectionMessages(
  election: Election,
  eligibleOrganizationIds: string[],
  opts: { candidateCount: number }
): Promise<ElectionMessage[]> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const orgs = eligibleOrganizationIds;

  const [call, ballots, reminder, notice, proxy, pkg, results] = await Promise.all([
    buildCallForNominations(election, orgs),
    buildBallotsOpen(election, orgs, { candidateCount: opts.candidateCount }),
    buildBallotsOpen(election, orgs, { candidateCount: opts.candidateCount, reminder: true }),
    buildAgmNotice(election, orgs, {
      agmTime: "[the meeting's time]",
      location: null,
      agmUrl: `${appUrl}/events/csc-annual-general-meeting-${election.cycleYear}`,
    }),
    buildProxyForm(election, orgs, {
      proxyFormUrl: `${appUrl}/elections/${election.slug}/proxy`,
      lateNote: null,
    }),
    buildAgmPackage(election, orgs, { stillToCome: "" }),
    buildElectionResults(election, orgs, {
      subject: `Your ${election.cycleYear} Board of Directors`,
      html: "<p>[the announcement, written after the meeting]</p>",
    }),
  ]);

  return Promise.all([
    describe(call, {
      key: "call",
      stage: "Nominations open",
      label: "Call for nominations",
    }),
    describe(ballots, {
      key: "ballots_open",
      stage: "Voting opens",
      label: "Voting is open",
    }),
    describe(reminder, {
      key: "ballot_reminder",
      stage: "Voting closes",
      label: "Reminder to those who have not voted",
    }),
    describe(notice, {
      key: "agm_notice",
      stage: "Notice of the meeting",
      label: "Notice of the annual general meeting",
      note: "The meeting's time is typed in when you send it; it appears here as a placeholder.",
    }),
    describe(proxy, {
      key: "proxy_form",
      stage: "Proxy form",
      label: "Proxy form",
    }),
    describe(pkg, {
      key: "agm_package",
      stage: "Members' AGM package",
      label: "AGM package is available",
    }),
    describe(results, {
      key: "results",
      stage: "After the meeting",
      label: "The result",
      note: "The announcement text is generated after certification; this shows the wrapper it goes in.",
    }),
  ]);
}

/**
 * The same list, resolved from a slug.
 *
 * Reads the eligible institutions from `election_eligibility` rather than
 * re-running evaluateElectionEligibility: the review page has just written
 * those rows on this same render, and evaluating again would double a
 * whole-membership write for a panel that only needs to know who it would
 * address.
 */
export async function getElectionMessagesForSlug(
  slug: string
): Promise<ElectionMessage[] | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getElection, listNominations } = await import("./service");

  const election = await getElection(slug);
  if (!election) return null;

  const db = createAdminClient();
  const [{ data: eligibleRows }, nominations] = await Promise.all([
    db
      .from("election_eligibility")
      .select("organization_id")
      .eq("election_id", election.id)
      .eq("is_eligible", true),
    listNominations(slug),
  ]);

  return getElectionMessages(
    election,
    (eligibleRows ?? []).map((r) => r.organization_id as string),
    { candidateCount: nominations.filter((n) => n.completeness.complete).length }
  );
}
