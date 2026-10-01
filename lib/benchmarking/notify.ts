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
 * A dead address IS now filtered out, though — that exemption was never meant
 * to cover mailboxes that do not exist. Since 2026-09-02, `comms_suppressions`
 * records why an address was suppressed, and `lib/email/send.ts` blocks any
 * send to a hard-bounced one regardless of how transactional it is. An
 * unsubscribed member still gets their survey; a member whose mailbox was
 * deleted gets a skip we can see, instead of a bounce we never noticed.
 * (Before this, the blocker was that Resend delivery events never reached the
 * webhook — fixed 2026-08-22, confirmed flowing 2026-09-02.)
 *
 * `invited_at` still records that Resend accepted the message, never that
 * anyone read it, and every send still returns a per-recipient outcome the
 * caller is expected to surface. The honest position is: we know what we
 * attempted.
 *
 * Nothing here throws. Sending mail must never be able to fail a survey action
 * — the record is the database, the email is a notification of it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateKey } from "@/lib/comms/types";
import { formatDeadline, formatOpening, daysUntilDeadline } from "./deadline";
import { getTemplate, renderTemplateContent } from "@/lib/comms/templates";
import type { StageMessage } from "@/lib/elections/messages";

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
  organizations: { name: string; is_test?: boolean | null } | null;
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
  filter: { uninvitedOnly?: boolean } = {},
): Promise<RecipientRow[]> {
  const db = createAdminClient();
  let q = db
    .from("benchmarking_recipients")
    .select(
      "id, organization_id, contact_id, is_beta, invited_at, reminder_count, organizations(name, is_test), contacts(name, first_name, email, work_email)",
    )
    .eq("survey_id", surveyId);

  if (filter.uninvitedOnly) q = q.is("invited_at", null);

  const { data } = await q;
  const rows = (data as unknown as RecipientRow[]) ?? [];

  /*
    Test organisations are on the recipient list so they can be picked and
    filed — walking the real survey end to end is the only way to check the
    wrappings, the wording and the buttons, and doing it against a real member
    store puts a receipt in a real person's inbox and their FTE through the
    pricing sync.

    They must never be MAILED, though, and that is enforced here rather than at
    each call site: this function feeds the invitation, every reminder, the
    closing notice and the submission receipt. One filter covers all of them.
  */
  return rows.filter((r) => r.organizations?.is_test !== true);
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
  | "no_address"
  /**
   * A beta send to a store where nobody can open the survey yet.
   *
   * ⛔ Two switches, on purpose: benchmarking_recipients.is_beta says who gets
   * the going-first email, and benchmarking.beta_tester says who may file
   * before the doors open. They answer different questions, so they are not
   * merged — but sending the first without the second mails somebody a link to
   * a locked door, and they find out by clicking it.
   */
;

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
  templateKey: string;
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

export async function planInvitations(surveyId: string): Promise<SendPlan | null> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return null;

  // Deliberately NOT filtered to uninvited in the query — the preview should
  // show the already-invited stores too, so the operator can see that running
  // it again is safe rather than having to trust that it is.
  const recipients = await loadRecipients(surveyId);

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
    templateKey: "benchmarking_invitation",
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
 * Skips anyone already invited, so running it twice does not mail a store
 * twice — which matters because the natural way to handle a partial failure is
 * to run it again.
 *
 * ⛔ There is no beta variant, deliberately. A beta tester is invited by being
 * APPOINTED: appointToCapability mails them the going-first copy and the survey
 * link, and they are the only person who can open a draft survey anyway. A
 * second send addressed to the store's confirmed respondent reached a different
 * person — one with no capability and therefore a locked door — so the store
 * got two invitations and the wrong one of them worked.
 */
export async function sendBenchmarkingInvitations(
  surveyId: string,
): Promise<SendSummary> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return summarise([], 0);

  // Same plan the operator was shown. Not a second, similar query.
  const plan = await planInvitations(surveyId);
  if (!plan) return summarise([], 0);

  const outcomes: NotifyOutcome[] = [];
  for (const line of plan.willSend) {
    const outcome = await send(
      plan.templateKey as TemplateKey,
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
      "benchmarking_reminder" as TemplateKey,
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
    "benchmarking_submission_received" as TemplateKey,
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

// ─────────────────────────────────────────────────────────────────
// What each step of the cycle sends
// ─────────────────────────────────────────────────────────────────

/**
 * The messages hanging off each timeline stage, for the admin spine.
 *
 * ⛔ Reuses StageMessage and the same getTemplate/renderTemplateContent pair
 * elections uses — the shape is not election-specific and neither is the
 * problem. The point is `missingTemplate`: a template row that is absent makes
 * the send fail at the moment it matters, and the only way anyone found out
 * was by sending. Now the step says so beforehand.
 *
 * Lives here rather than in its own module because this file already decides
 * which template each benchmarking event uses; a second place to answer that
 * is a second place for them to disagree.
 */
export async function benchmarkingStageMessages(
  surveyId: string,
): Promise<Record<string, StageMessage[]>> {
  const survey = await loadSurvey(surveyId);
  if (!survey) return {};

  const closes = (survey.closes_at ? formatDeadline(survey.closes_at) : null) ?? "the closing date";
  const opens = survey.opens_at
    ? new Date(survey.opens_at).toLocaleDateString("en-CA", {
        year: "numeric", month: "long", day: "numeric",
      })
    : "the opening date";

  /*
    A stand-in store, used for rendering the preview. Clearly bracketed rather
    than invented, so nobody mistakes it for a real recipient — the same move
    elections makes with an empty electorate.
  */
  const sample = {
    contact_name: "[their first name]",
    organization_name: "[their store]",
    fiscal_year: String(survey.fiscal_year),
    opens_date: opens,
    closes_date: closes,
    days_remaining: "7",
    survey_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/benchmarking/survey`,
    submitted_date: "[the day they filed]",
    task_title: "[the workstream]",
    task_summary: "[what it is, in one line]",
    what_you_do: "[what the workstream asks of them]",
    time_commitment: "[how long]",
    window: "[when]",
    task_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/benchmarking/survey`,
    deadline_line: "",
    first_name: "[their first name]",
  };

  async function describe(
    templateKey: string,
    meta: {
      key: string; label: string; stage: string; recipientCount: number | null;
      /*
        ⛔ Per-message overrides. One shared sample rendered the REVIEWER's
        invitation as "A small ask: Beta testing", because the committee
        template takes a task_title and the sample only had one value for it.
        A preview that shows the wrong subject is worse than no preview: it is
        read as what will go out.
      */
      vars?: Record<string, string>;
    },
  ): Promise<StageMessage> {
    const template = await getTemplate(templateKey as TemplateKey);
    const variables = { ...sample, ...(meta.vars ?? {}) };
    const rendered = template
      ? renderTemplateContent(template, {
          app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
          ...variables,
        })
      : { subject: "", bodyHtml: "" };

    return {
      key: meta.key,
      stage: meta.stage,
      label: meta.label,
      templateKey: templateKey as TemplateKey,
      templateId: template?.id ?? null,
      missingTemplate: !template,
      isTransactional: template?.is_transactional ?? true,
      subject: template?.subject ?? "",
      bodyHtml: template?.body_html ?? "",
      variableKeys: template?.variable_keys ?? Object.keys(variables),
      variables,
      recipientCount: meta.recipientCount,
      renderedSubject: rendered.subject,
      note: template ? null : "No template row exists, so this step would fail to send.",
    };
  }

  // How many each step would actually reach, from the same planners the send
  // panel uses. Not a second count.
  const invitePlan = await planInvitations(surveyId);
  const remindPlan = await planReminders(surveyId);

  const [appointReviewer, appointTester, invitation, reminder, receipt] = await Promise.all([
    describe("benchmarking_committee_invitation", {
      key: "reviewer_appointment", stage: "question_review",
      label: "Invitation to review the questions", recipientCount: null,
      vars: {
        task_title: "Question review",
        task_summary: "Check the questions that caused trouble last year, and write the examples.",
        time_commitment: "About 30 minutes",
        window: "September, before the survey opens",
      },
    }),
    describe("benchmarking_beta_invitation", {
      key: "beta_appointment", stage: "appoint_testers",
      label: "Going first — sent when you appoint them", recipientCount: null,
    }),
    describe("benchmarking_invitation", {
      key: "invitation", stage: "invitations",
      label: "The survey is open", recipientCount: invitePlan?.willSend.length ?? null,
    }),
    describe("benchmarking_reminder", {
      key: "reminder", stage: "reminders",
      label: "Reminder", recipientCount: remindPlan?.willSend.length ?? null,
    }),
    describe("benchmarking_submission_received", {
      key: "receipt", stage: "open",
      label: "Receipt, sent when a store files", recipientCount: null,
    }),
  ]);

  return {
    question_review: [appointReviewer],
    appoint_testers: [appointTester],
    invitations: [invitation],
    reminders: [reminder],
    open: [receipt],
  };
}
