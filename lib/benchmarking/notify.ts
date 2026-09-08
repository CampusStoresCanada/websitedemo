/**
 * Benchmarking email.
 *
 * Every send here is TRANSACTIONAL under CASL and the templates are flagged as
 * such, which means they bypass `comms_suppressions`. Same reasoning as
 * election mail: the benchmarking survey is a membership obligation and a
 * member benefit, not a commercial electronic message. A member who once
 * unsubscribed from conference marketing must still be told their own store's
 * survey is open. Being unable to receive your own survey is exclusion by
 * mailing-list preference, and the whole point of this cycle is to move 37 of
 * 52 stores closer to 52.
 *
 * The cost of that choice is that a dead address is also not filtered out. We
 * cannot currently detect one — Resend delivery events have never reached the
 * webhook, so `comms_suppressions` holds unsubscribes only and bounce
 * auto-suppression is not functioning. So `invited_at` records that Resend
 * accepted the message, never that anyone read it, and every send returns a
 * per-recipient outcome the caller is expected to surface. The honest position
 * is: we know what we attempted.
 *
 * Nothing here throws. Sending mail must never be able to fail a survey action
 * — the record is the database, the email is a notification of it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateKey } from "@/lib/comms/types";
import { formatDeadline, formatOpening, daysUntilDeadline } from "./deadline";

export interface NotifyOutcome {
  template: string;
  organizationId: string;
  organizationName: string;
  to: string;
  sent: boolean;
  error?: string;
}

export interface SendSummary {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  outcomes: NotifyOutcome[];
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
}

/**
 * A plain calendar date, for anything that is not the closing boundary.
 * The deadline goes through formatDeadline() instead — see lib/benchmarking/
 * deadline.ts for why the two cannot share a formatter.
 */
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
 * Hard off-switch, checked at the single point every benchmarking email passes
 * through.
 *
 * This module addresses all 52 real member institutions from a table that is
 * already populated. It relies on this rather than on `DEV_EMAIL_INTERCEPT`,
 * because the intercept is an environment setting a CI box or a colleague's
 * machine may not have — and "did not email 52 campus stores" is not a property
 * to leave to configuration.
 */
function emailSuppressed(): boolean {
  return process.env.BENCHMARKING_SUPPRESS_EMAIL === "1";
}

async function send(
  templateKey: TemplateKey,
  to: string | null | undefined,
  organizationId: string,
  organizationName: string,
  variables: Record<string, string | number | null | undefined>,
): Promise<NotifyOutcome> {
  const base = { template: templateKey, organizationId, organizationName };

  if (emailSuppressed()) {
    return { ...base, to: to ?? "", sent: false, error: "suppressed" };
  }
  if (!to?.trim()) {
    // A store with no address on its recipient row is a real and common state —
    // 15 of the 52 are exactly the stores CSC knows least about. Reporting it
    // beats pretending the message went out.
    return { ...base, to: "", sent: false, error: "No email address on record." };
  }

  try {
    // Imported here, not at module scope: `lib/comms/send` constructs a Resend
    // client on load and throws without an API key, which would make this
    // module — and anything importing it — unloadable in a test run or any
    // environment that does not send mail. A suppressed run never touches
    // Resend at all.
    const { sendTransactional } = await import("@/lib/comms/send");
    const result = await sendTransactional({ templateKey, to, variables });
    return { ...base, to, sent: result.success, error: result.error };
  } catch (err) {
    return {
      ...base,
      to,
      sent: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  }
}

interface SurveyRow {
  id: string;
  fiscal_year: number;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
}

interface RecipientRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  is_beta: boolean;
  invited_at: string | null;
  reminder_count: number;
  organizations: { name: string } | null;
  contacts: { name: string | null; first_name: string | null; email: string | null; work_email: string | null } | null;
}

function recipientEmail(r: RecipientRow): string | null {
  // Work address first: this is a message about their job, and a personal
  // address on a contact row is often a legacy import rather than a preference.
  return r.contacts?.work_email?.trim() || r.contacts?.email?.trim() || null;
}

function recipientName(r: RecipientRow): string {
  return r.contacts?.first_name?.trim() || r.contacts?.name?.trim() || "there";
}

async function loadSurvey(surveyId: string): Promise<SurveyRow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_surveys")
    .select("id, fiscal_year, status, opens_at, closes_at")
    .eq("id", surveyId)
    .maybeSingle();
  return (data as SurveyRow) ?? null;
}

async function loadSurveyByYear(fiscalYear: number): Promise<SurveyRow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_surveys")
    .select("id, fiscal_year, status, opens_at, closes_at")
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();
  return (data as SurveyRow) ?? null;
}

async function loadRecipients(
  surveyId: string,
  filter: { betaOnly?: boolean; uninvitedOnly?: boolean } = {},
): Promise<RecipientRow[]> {
  const db = createAdminClient();
  let q = db
    .from("benchmarking_recipients")
    .select(
      "id, organization_id, contact_id, is_beta, invited_at, reminder_count, organizations(name), contacts(name, first_name, email, work_email)",
    )
    .eq("survey_id", surveyId);

  if (filter.betaOnly) q = q.eq("is_beta", true);
  if (filter.uninvitedOnly) q = q.is("invited_at", null);

  const { data } = await q;
  return (data as unknown as RecipientRow[]) ?? [];
}

/** Organization ids that have already filed for this fiscal year. */
async function submittedOrgIds(fiscalYear: number): Promise<Set<string>> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking")
    .select("organization_id, status")
    .eq("fiscal_year", fiscalYear);

  const done = new Set<string>();
  for (const row of (data ?? []) as { organization_id: string; status: string | null }[]) {
    // A draft is not a submission. Someone who saved and walked away is exactly
    // who a reminder is for.
    if (row.status && row.status !== "draft") done.add(row.organization_id);
  }
  return done;
}

async function markInvited(recipientId: string, outcome: NotifyOutcome): Promise<void> {
  const db = createAdminClient();
  await db
    .from("benchmarking_recipients")
    .update(
      outcome.sent
        ? { invited_at: new Date().toISOString(), last_send_error: null }
        : { last_send_error: outcome.error ?? "Send failed." },
    )
    .eq("id", recipientId);
}

async function markReminded(
  recipientId: string,
  currentCount: number,
  outcome: NotifyOutcome,
): Promise<void> {
  const db = createAdminClient();
  await db
    .from("benchmarking_recipients")
    .update(
      outcome.sent
        ? {
            reminded_at: new Date().toISOString(),
            reminder_count: currentCount + 1,
            last_send_error: null,
          }
        : { last_send_error: outcome.error ?? "Send failed." },
    )
    .eq("id", recipientId);
}

function summarise(outcomes: NotifyOutcome[], skipped: number): SendSummary {
  return {
    attempted: outcomes.length,
    sent: outcomes.filter((o) => o.sent).length,
    failed: outcomes.filter((o) => !o.sent).length,
    skipped,
    outcomes,
  };
}

export type BlockedReason =
  | "already_invited"
  | "already_submitted"
  | "never_invited"
  | "no_address";

export interface PlannedSend {
  recipientId: string;
  organizationId: string;
  organizationName: string;
  contactName: string;
  to: string | null;
  willSend: boolean;
  blockedReason?: BlockedReason;
}

export interface SendPlan {
  surveyId: string;
  fiscalYear: number;
  surveyStatus: string;
  templateKey: TemplateKey;
  /** BENCHMARKING_SUPPRESS_EMAIL is set — a "send" would mail nobody. */
  killSwitchOn: boolean;
  willSend: PlannedSend[];
  blocked: PlannedSend[];
}

function planLine(r: RecipientRow, blockedReason?: BlockedReason): PlannedSend {
  const to = recipientEmail(r);
  return {
    recipientId: r.id,
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? "Unknown store",
    contactName: recipientName(r),
    to,
    willSend: !blockedReason,
    blockedReason,
  };
}

/**
 * Who WOULD be mailed, and who would not, and why.
 *
 * This is the single source of truth for both the preview and the send. A dry
 * run that derives its list separately is worse than no dry run at all: it
 * would reassure someone with a list that the real send does not use, and the
 * first time the two disagree is the time it matters.
 */
export async function planInvitations(
  surveyId: string,
  options: { betaOnly?: boolean } = {},
): Promise<SendPlan | null> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return null;

  // Deliberately NOT filtered to uninvited in the query — the preview should
  // show the already-invited stores too, so the operator can see that running
  // it again is safe rather than having to trust that it is.
  const recipients = await loadRecipients(surveyId, { betaOnly: options.betaOnly });

  const willSend: PlannedSend[] = [];
  const blocked: PlannedSend[] = [];

  for (const r of recipients) {
    if (r.invited_at) blocked.push(planLine(r, "already_invited"));
    else if (!recipientEmail(r)) blocked.push(planLine(r, "no_address"));
    else willSend.push(planLine(r));
  }

  return {
    surveyId,
    fiscalYear: survey.fiscal_year,
    surveyStatus: survey.status,
    templateKey: options.betaOnly
      ? "benchmarking_beta_invitation"
      : "benchmarking_invitation",
    killSwitchOn: emailSuppressed(),
    willSend,
    blocked,
  };
}

/** The same, for the chase. */
export async function planReminders(surveyId: string): Promise<SendPlan | null> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return null;

  const [recipients, done] = await Promise.all([
    loadRecipients(surveyId),
    submittedOrgIds(survey.fiscal_year),
  ]);

  const willSend: PlannedSend[] = [];
  const blocked: PlannedSend[] = [];

  for (const r of recipients) {
    if (done.has(r.organization_id)) blocked.push(planLine(r, "already_submitted"));
    else if (!r.invited_at) blocked.push(planLine(r, "never_invited"));
    else if (!recipientEmail(r)) blocked.push(planLine(r, "no_address"));
    else willSend.push(planLine(r));
  }

  return {
    surveyId,
    fiscalYear: survey.fiscal_year,
    surveyStatus: survey.status,
    templateKey: "benchmarking_reminder",
    killSwitchOn: emailSuppressed(),
    willSend,
    blocked,
  };
}

/**
 * Invite the stores whose survey is open.
 *
 * `betaOnly` sends the going-first copy to the flagged stores; without it this
 * sends the general invitation. Both skip anyone already invited, so running it
 * twice does not mail a store twice — which matters because the natural way to
 * handle a partial failure is to run it again.
 */
export async function sendBenchmarkingInvitations(
  surveyId: string,
  options: { betaOnly?: boolean } = {},
): Promise<SendSummary> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return summarise([], 0);

  // Same plan the operator was shown. Not a second, similar query.
  const plan = await planInvitations(surveyId, options);
  if (!plan) return summarise([], 0);

  const outcomes: NotifyOutcome[] = [];
  for (const line of plan.willSend) {
    const outcome = await send(
      plan.templateKey,
      line.to,
      line.organizationId,
      line.organizationName,
      {
        contact_name: line.contactName,
        organization_name: line.organizationName,
        fiscal_year: survey.fiscal_year,
        opens_date: formatOpening(survey.opens_at) ?? "",
        closes_date: formatDeadline(survey.closes_at) ?? "",
        survey_url: `${appUrl()}/benchmarking/survey`,
      },
    );

    await markInvited(line.recipientId, outcome);
    outcomes.push(outcome);
  }

  return summarise(outcomes, plan.blocked.length);
}

/**
 * Chase the stores that have not filed.
 *
 * Never sent to a store that has submitted, and never to one that was never
 * successfully invited — chasing someone about a survey they were never told
 * about reads as incompetence, and the fix for those is the invitation, not a
 * reminder.
 */
export async function sendBenchmarkingReminders(surveyId: string): Promise<SendSummary> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return summarise([], 0);

  const plan = await planReminders(surveyId);
  if (!plan) return summarise([], 0);

  const daysRemaining = daysUntilDeadline(survey.closes_at);
  const counts = new Map(
    (await loadRecipients(surveyId)).map((r) => [r.id, r.reminder_count ?? 0]),
  );

  const outcomes: NotifyOutcome[] = [];
  for (const line of plan.willSend) {
    const outcome = await send(
      "benchmarking_reminder",
      line.to,
      line.organizationId,
      line.organizationName,
      {
        contact_name: line.contactName,
        organization_name: line.organizationName,
        fiscal_year: survey.fiscal_year,
        closes_date: formatDeadline(survey.closes_at) ?? "",
        days_remaining: daysRemaining,
        survey_url: `${appUrl()}/benchmarking/survey`,
      },
    );

    await markReminded(line.recipientId, counts.get(line.recipientId) ?? 0, outcome);
    outcomes.push(outcome);
  }

  return summarise(outcomes, plan.blocked.length);
}

/**
 * Confirm a submission to whoever filed it.
 *
 * Fire-and-forget from the submit path: a store's figures are saved whether or
 * not we manage to tell them so.
 */
export async function sendSubmissionReceipt(
  fiscalYear: number,
  organizationId: string,
): Promise<NotifyOutcome | null> {
  // Keyed on fiscal year, not a survey id: `benchmarking` has no survey_id
  // column — the year is what ties a submission to its cycle.
  const survey = await loadSurveyByYear(fiscalYear);
  if (!survey) return null;

  const recipients = await loadRecipients(survey.id);
  const r = recipients.find((x) => x.organization_id === organizationId);
  if (!r) return null;

  const orgName = r.organizations?.name ?? "your store";
  return send(
    "benchmarking_submission_received",
    recipientEmail(r),
    organizationId,
    orgName,
    {
      contact_name: recipientName(r),
      organization_name: orgName,
      fiscal_year: survey.fiscal_year,
      submitted_date: formatDate(new Date().toISOString()),
      closes_date: formatDeadline(survey.closes_at) ?? "",
    },
  );
}
