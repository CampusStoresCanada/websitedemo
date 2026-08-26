import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { EXPECTED_BOARD_SIZE } from "@/lib/board/vote-roster";
import {
  diffDbAccessDrift,
  type DbAccessDriftReport,
} from "@/lib/ops/db-access-baseline";

type Severity = "info" | "warning" | "critical";

type CandidateAlert = {
  ruleKey: string;
  severity: Severity;
  message: string;
  details: Record<string, unknown>;
};

type OpsAlertRow = {
  id: string;
  rule_key: string;
  status: "open" | "acknowledged" | "resolved";
};

type RenewalRunRow = {
  job_type: string;
  status: string;
  started_at: string;
};

function hoursBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return (b - a) / (1000 * 60 * 60);
}

// Rule keys (or prefixes) that evaluateCandidates() can emit. The resolve
// sweep in evaluateOpsAlerts() only auto-closes alerts in this set — every
// candidate check re-runs on each pass, so "not in activeRuleKeys anymore"
// reliably means "condition cleared." Event-driven alerts raised elsewhere
// via raiseAlertIfNotOpen() (QBO, OneDrive, board export, scheduled
// conference transitions, ...) are never re-evaluated here, so they must be
// excluded or every one of them would be wrongly auto-resolved on the very
// next periodic run regardless of whether the underlying failure was fixed.
const PERIODIC_RULE_KEYS = new Set([
  "scheduler_infeasible",
  "payment_failure_rate",
  "sync_backlog",
  "webhook_backlog",
  "swap_stale_conflicts",
  "auth_guard_deny_spike",
  "login_redirect_loop",
  "auth_bootstrap_recovery_failure",
  "legal_acceptance_gap",
  "retention_overdue",
  "qbo_export_backlog",
  "orgs_missing_admin",
  "board_meeting_not_closed_out",
  "board_no_upcoming_meeting",
  "board_action_item_overdue",
  "board_minutes_overdue",
  "board_vote_awaiting_execution",
  "board_vote_lapsed_unresolved",
  "board_vote_not_closed",
  "board_roster_size_mismatch",
]);
const PERIODIC_RULE_KEY_PREFIXES = ["job_consecutive_failures:", "db_access_drift:"];

function isPeriodicRuleKey(ruleKey: string): boolean {
  return (
    PERIODIC_RULE_KEYS.has(ruleKey) ||
    PERIODIC_RULE_KEY_PREFIXES.some((prefix) => ruleKey.startsWith(prefix))
  );
}

async function insertAlert(candidate: CandidateAlert): Promise<void> {
  const db = createAdminClient() as unknown as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };

  const { error } = await db.from("ops_alerts").insert({
    rule_key: candidate.ruleKey,
    severity: candidate.severity,
    status: "open",
    message: candidate.message,
    details: candidate.details,
    is_acknowledged: false,
  });

  if (error) {
    throw new Error(`Failed to insert ops alert (${candidate.ruleKey}): ${error.message}`);
  }

  await logAuditEventSafe({
    action: "ops_alert_opened",
    entityType: "ops_alert",
    actorType: "system",
    details: {
      ruleKey: candidate.ruleKey,
      severity: candidate.severity,
      message: candidate.message,
    },
  });
}

async function resolveAlert(alertId: string, ruleKey: string): Promise<void> {
  const db = createAdminClient() as unknown as {
    from: (table: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };

  const now = new Date().toISOString();
  const { error } = await db
    .from("ops_alerts")
    .update({
      status: "resolved",
      resolved_at: now,
      is_acknowledged: true,
      acknowledged_at: now,
      acknowledged_by: null,
      resolved_by: null,
    })
    .eq("id", alertId);

  if (error) {
    throw new Error(`Failed to resolve ops alert (${ruleKey}): ${error.message}`);
  }

  await logAuditEventSafe({
    action: "ops_alert_auto_resolved",
    entityType: "ops_alert",
    entityId: alertId,
    actorType: "system",
    details: {
      ruleKey,
    },
  });
}

async function evaluateConsecutiveRenewalFailures(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("renewal_job_runs")
    .select("job_type, status, started_at")
    .order("started_at", { ascending: false })
    .limit(120);

  if (error) {
    throw new Error(`Failed to evaluate renewal failures: ${error.message}`);
  }

  const runs = (data ?? []) as RenewalRunRow[];
  const byType = new Map<string, RenewalRunRow[]>();
  for (const run of runs) {
    const list = byType.get(run.job_type) ?? [];
    if (list.length < 3) {
      list.push(run);
      byType.set(run.job_type, list);
    }
  }

  for (const [jobType, latestThree] of byType.entries()) {
    if (latestThree.length < 3) continue;
    const consecutiveFailures = latestThree.every((row) => row.status === "failed");
    if (!consecutiveFailures) continue;

    return {
      ruleKey: `job_consecutive_failures:${jobType}`,
      severity: "critical",
      message: `Renewal job '${jobType}' failed for 3 consecutive runs.`,
      details: {
        jobType,
        latestRuns: latestThree,
      },
    };
  }

  return null;
}

async function evaluateSchedulerInfeasible(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("scheduler_runs")
    .select("id, status, started_at, conference_id, run_mode")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to evaluate scheduler status: ${error.message}`);
  }

  if (!data || data.status !== "infeasible") {
    return null;
  }

  return {
    ruleKey: "scheduler_infeasible",
    severity: "critical",
    message: "Latest scheduler run is infeasible.",
    details: {
      runId: data.id,
      startedAt: data.started_at,
      conferenceId: data.conference_id,
      runMode: data.run_mode,
    },
  };
}

async function evaluateBillingFailureRate(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("billing_runs")
    .select("id, status, total_items, failed_items, started_at, conference_id")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to evaluate billing failure rate: ${error.message}`);
  }

  if (!data) return null;

  const total = data.total_items ?? 0;
  const failed = data.failed_items ?? 0;
  if (total <= 0) return null;

  const failureRate = failed / total;
  if (failureRate <= 0.2) return null;

  return {
    ruleKey: "payment_failure_rate",
    severity: "critical",
    message: `Latest billing run failure rate is ${(failureRate * 100).toFixed(1)}% (${failed}/${total}).`,
    details: {
      runId: data.id,
      conferenceId: data.conference_id,
      startedAt: data.started_at,
      total,
      failed,
      failureRate,
      status: data.status,
    },
  };
}

async function evaluateCircleBacklog(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const [{ count, error: countError }, oldestRes] = await Promise.all([
    db
      .from("circle_sync_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "queued", "retrying"]),
    db
      .from("circle_sync_queue")
      .select("id, created_at, status")
      .in("status", ["pending", "queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (countError) {
    throw new Error(`Failed to evaluate circle backlog: ${countError.message}`);
  }
  if (oldestRes.error) {
    throw new Error(`Failed to evaluate circle backlog oldest item: ${oldestRes.error.message}`);
  }

  const pendingCount = count ?? 0;
  if (pendingCount <= 50 || !oldestRes.data?.created_at) {
    return null;
  }

  const ageHours = hoursBetween(oldestRes.data.created_at, new Date().toISOString());
  if (ageHours < 1) {
    return null;
  }

  return {
    ruleKey: "sync_backlog",
    severity: "warning",
    message: `Circle sync backlog is ${pendingCount} pending items; oldest is ${ageHours.toFixed(1)}h old.`,
    details: {
      pendingCount,
      oldestCreatedAt: oldestRes.data.created_at,
      oldestAgeHours: ageHours,
    },
  };
}

async function evaluateWebhookBacklog(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [stripeRes, conferenceRes] = await Promise.all([
    db
      .from("stripe_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("result", "error")
      .gte("processed_at", sinceIso),
    db
      .from("conference_webhook_events")
      .select("stripe_event_id", { count: "exact", head: true })
      .eq("success", false)
      .gte("processed_at", sinceIso),
  ]);

  if (stripeRes.error) {
    throw new Error(`Failed to evaluate Stripe webhook backlog: ${stripeRes.error.message}`);
  }
  if (conferenceRes.error) {
    throw new Error(
      `Failed to evaluate conference webhook backlog: ${conferenceRes.error.message}`
    );
  }

  const stripeFailed = stripeRes.count ?? 0;
  const conferenceFailed = conferenceRes.count ?? 0;
  const totalFailed = stripeFailed + conferenceFailed;

  if (totalFailed <= 10) {
    return null;
  }

  return {
    ruleKey: "webhook_backlog",
    severity: "warning",
    message: `Webhook backlog detected: ${totalFailed} failed webhook events in the last hour.`,
    details: {
      windowHours: 1,
      stripeFailed,
      conferenceFailed,
      totalFailed,
      sinceIso,
    },
  };
}

async function evaluateSwapStaleConflicts(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("audit_log")
    .select("details")
    .eq("action", "swap_request_commit")
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(`Failed to evaluate swap stale conflicts: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ details?: Record<string, unknown> | null }>;
  if (rows.length === 0) return null;

  let staleCount = 0;
  for (const row of rows) {
    const details = row.details ?? {};
    const success = details.success === true;
    const reason = typeof details.reason === "string" ? details.reason : "";
    if (!success && reason === "stale_schedule_conflict") staleCount += 1;
  }

  const staleRate = staleCount / rows.length;
  if (staleCount < 5 || staleRate <= 0.2) return null;

  return {
    ruleKey: "swap_stale_conflicts",
    severity: "warning",
    message: `Swap stale conflicts elevated: ${staleCount}/${rows.length} (${(
      staleRate * 100
    ).toFixed(1)}%) in the last 24h.`,
    details: {
      windowHours: 24,
      staleCount,
      totalSwapCommits: rows.length,
      staleRate,
      sinceIso,
    },
  };
}

async function evaluateAuthGuardDenySpike(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [deniedRes, errorRes] = await Promise.all([
    db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth_guard_denied")
      .gte("created_at", sinceIso),
    db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth_guard_error")
      .gte("created_at", sinceIso),
  ]);

  if (deniedRes.error) {
    throw new Error(`Failed to evaluate auth guard deny spike: ${deniedRes.error.message}`);
  }
  if (errorRes.error) {
    throw new Error(`Failed to evaluate auth guard error spike: ${errorRes.error.message}`);
  }

  const denied = deniedRes.count ?? 0;
  const guardErrors = errorRes.count ?? 0;
  if (denied <= 25 && guardErrors <= 10) return null;

  return {
    ruleKey: "auth_guard_deny_spike",
    severity: guardErrors > 10 ? "critical" : "warning",
    message: `Auth guard anomaly: denies=${denied}/h, guard_errors=${guardErrors}/h.`,
    details: {
      windowHours: 1,
      denied,
      guardErrors,
      deniedThreshold: 25,
      guardErrorThreshold: 10,
      sinceIso,
    },
  };
}

async function evaluateLoginRedirectLoop(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "auth_login_redirect_loop")
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(`Failed to evaluate login redirect loops: ${error.message}`);
  }

  const loopCount = count ?? 0;
  if (loopCount === 0) return null;

  return {
    ruleKey: "login_redirect_loop",
    severity: "critical",
    message: `Login redirect loop detected (${loopCount} event(s) in the last hour).`,
    details: {
      windowHours: 1,
      loopCount,
      sinceIso,
    },
  };
}

async function evaluateBootstrapRecoveryFailure(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "auth_bootstrap_recovery_failed")
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(`Failed to evaluate bootstrap recovery failures: ${error.message}`);
  }

  const failureCount = count ?? 0;
  if (failureCount === 0) return null;

  return {
    ruleKey: "auth_bootstrap_recovery_failure",
    severity: "critical",
    message: `Auth bootstrap recovery failures detected (${failureCount} in the last hour).`,
    details: {
      windowHours: 1,
      failureCount,
      sinceIso,
    },
  };
}

async function evaluateLegalAcceptanceGap(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const { data: conference, error: conferenceError } = await db
    .from("conference_instances")
    .select("id, name, start_date, year, edition_code")
    .order("year", { ascending: false })
    .order("edition_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (conferenceError) {
    throw new Error(`Failed to evaluate legal acceptance gap: ${conferenceError.message}`);
  }
  if (!conference) return null;

  if (!conference.start_date) return null;
  const now = new Date();
  const start = new Date(`${conference.start_date}T00:00:00Z`);
  const daysUntil = Math.floor((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil > 30) return null;

  const [legalRes, regsRes] = await Promise.all([
    db
      .from("conference_legal_versions")
      .select("id, document_type, version, effective_at")
      .eq("conference_id", conference.id)
      .lte("effective_at", now.toISOString())
      .order("document_type", { ascending: true })
      .order("version", { ascending: false }),
    db
      .from("conference_registrations")
      .select("user_id")
      .eq("conference_id", conference.id)
      .in("status", ["submitted", "confirmed"]),
  ]);

  if (legalRes.error) {
    throw new Error(`Failed to load legal versions: ${legalRes.error.message}`);
  }
  if (regsRes.error) {
    throw new Error(`Failed to load conference registrations: ${regsRes.error.message}`);
  }

  const latestByType = new Map<string, { id: string; document_type: string }>();
  for (const row of legalRes.data ?? []) {
    if (!latestByType.has(row.document_type)) {
      latestByType.set(row.document_type, {
        id: row.id,
        document_type: row.document_type,
      });
    }
  }
  if (latestByType.size === 0) return null;

  const requiredUsers = new Set((regsRes.data ?? []).map((row) => row.user_id));
  const requiredCount = requiredUsers.size;
  if (requiredCount === 0) return null;

  const legalVersionIds = [...latestByType.values()].map((row) => row.id);
  const { data: acceptanceRows, error: acceptanceError } = await db
    .from("legal_acceptances")
    .select("user_id, legal_version_id")
    .in("legal_version_id", legalVersionIds);

  if (acceptanceError) {
    throw new Error(`Failed to load legal acceptances: ${acceptanceError.message}`);
  }

  const acceptedByVersion = new Map<string, Set<string>>();
  for (const row of acceptanceRows ?? []) {
    if (!requiredUsers.has(row.user_id)) continue;
    const set = acceptedByVersion.get(row.legal_version_id) ?? new Set<string>();
    set.add(row.user_id);
    acceptedByVersion.set(row.legal_version_id, set);
  }

  const threshold = 0.9;
  const gaps: Array<{ documentType: string; coverage: number }> = [];
  for (const { id, document_type } of latestByType.values()) {
    const acceptedCount = acceptedByVersion.get(id)?.size ?? 0;
    const coverage = acceptedCount / requiredCount;
    if (coverage < threshold) {
      gaps.push({ documentType: document_type, coverage });
    }
  }

  if (gaps.length === 0) return null;

  return {
    ruleKey: "legal_acceptance_gap",
    severity: "warning",
    message: `Legal acceptance below 90% for ${gaps.length} required document type(s) with conference ${daysUntil} day(s) away.`,
    details: {
      conferenceId: conference.id,
      conferenceName: conference.name,
      daysUntilConferenceStart: daysUntil,
      requiredUsers: requiredCount,
      thresholdPct: 90,
      gaps: gaps.map((g) => ({
        documentType: g.documentType,
        coveragePct: Number((g.coverage * 100).toFixed(1)),
      })),
    },
  };
}

async function evaluateRetentionOverdue(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const now = new Date();
  const { data: conferences, error: conferenceError } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code")
    .order("year", { ascending: false })
    .order("edition_code", { ascending: false })
    .limit(20);

  if (conferenceError) {
    throw new Error(`Failed to evaluate retention overdue: ${conferenceError.message}`);
  }
  const conferenceRows = conferences ?? [];
  if (conferenceRows.length === 0) return null;

  const dueConferences = conferenceRows.map((conference) => {
    const cutoffAt = new Date(
      Date.UTC(conference.year, 2, 1, 0, 0, 0, 0)
    ).toISOString();
    const cutoffMs = new Date(cutoffAt).getTime();
    const overdueHours = (now.getTime() - cutoffMs) / (1000 * 60 * 60);
    return {
      conference,
      cutoffAt,
      overdueHours,
      isDue: overdueHours >= 0,
    };
  }).filter((row) => row.isDue);

  if (dueConferences.length === 0) return null;

  const { data: runs, error: runsError } = await db
    .from("retention_jobs")
    .select("conference_id, status, executed_at, cutoff_at, error_details")
    .in(
      "conference_id",
      dueConferences.map((row) => row.conference.id)
    )
    .order("executed_at", { ascending: false });

  if (runsError) {
    throw new Error(`Failed to evaluate retention run telemetry: ${runsError.message}`);
  }

  const runsByConference = new Map<
    string,
    Array<{
      conference_id: string;
      status: "completed" | "failed";
      executed_at: string;
      cutoff_at: string;
      error_details: string | null;
    }>
  >();
  for (const row of runs ?? []) {
    const list = runsByConference.get(row.conference_id) ?? [];
    list.push({
      conference_id: row.conference_id,
      status: row.status as "completed" | "failed",
      executed_at: row.executed_at,
      cutoff_at: row.cutoff_at,
      error_details: row.error_details,
    });
    runsByConference.set(row.conference_id, list);
  }

  const overdue: Array<{
    conferenceId: string;
    conferenceName: string;
    year: number;
    editionCode: string;
    cutoffAt: string;
    overdueHours: number;
    latestStatus: "none" | "completed" | "failed";
    latestExecutedAt: string | null;
  }> = [];

  for (const row of dueConferences) {
    const conferenceId = row.conference.id;
    const conferenceRuns = runsByConference.get(conferenceId) ?? [];
    const completedForCutoff = conferenceRuns.find(
      (run) => run.status === "completed" && run.cutoff_at === row.cutoffAt
    );
    if (completedForCutoff) continue;

    const latest = conferenceRuns[0];
    overdue.push({
      conferenceId,
      conferenceName: row.conference.name,
      year: row.conference.year,
      editionCode: row.conference.edition_code,
      cutoffAt: row.cutoffAt,
      overdueHours: row.overdueHours,
      latestStatus: latest?.status ?? "none",
      latestExecutedAt: latest?.executed_at ?? null,
    });
  }

  if (overdue.length === 0) return null;

  const hasFailed = overdue.some((row) => row.latestStatus === "failed");
  const maxOverdueHours = Math.max(...overdue.map((row) => row.overdueHours));
  const severity: Severity = hasFailed || maxOverdueHours >= 24 ? "critical" : "warning";

  return {
    ruleKey: "retention_overdue",
    severity,
    message: `Retention purge overdue for ${overdue.length} conference(s).`,
    details: {
      evaluatedAt: now.toISOString(),
      overdueCount: overdue.length,
      hasFailed,
      maxOverdueHours: Number(maxOverdueHours.toFixed(1)),
      overdue,
    },
  };
}

async function evaluateQBExportBacklog(): Promise<CandidateAlert | null> {
  const db = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string, opts?: { count?: "exact"; head?: boolean }) => {
        eq: (column: string, value: unknown) => Promise<{
          data: unknown[] | null;
          count: number | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { count, error } = await db
    .from("qbo_export_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  if (error) {
    throw new Error(`Failed to evaluate QB export backlog: ${error.message}`);
  }

  const failedCount = count ?? 0;
  if (failedCount === 0) return null;

  return {
    ruleKey: "qbo_export_backlog",
    severity: failedCount >= 3 ? "critical" : "warning",
    message: `${failedCount} QB export(s) have exhausted all retries and need attention.`,
    details: { failedCount },
  };
}

/**
 * Every active org needs an org_admin — otherwise billing/renewal notices
 * (see lib/renewal/jobs.ts's resolveRenewalRecipients, lib/stripe/billing.ts's
 * ensureStripeCustomer) fall back to organizations.email, then a contacts-
 * table person, and can end up with nowhere to send at all. 2026-08-02: 26
 * active orgs had neither an org_admin nor organizations.email; 8 of those
 * had a real person in `contacts` the whole time, un-promoted, un-flagged.
 * Distinguishes "has a contact, just needs promoting" (actionable in one
 * click) from "needs actual outreach" (nobody on file at all) since a
 * super_admin should triage those very differently.
 */
async function evaluateOrgsMissingAdmin(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data: orgs, error: orgsError } = await db
    .from("organizations")
    .select("id, name, type")
    .in("membership_status", ["active", "reactivated"]);

  if (orgsError) {
    throw new Error(`Failed to evaluate orgs missing admin: ${orgsError.message}`);
  }
  const orgRows = orgs ?? [];
  if (orgRows.length === 0) return null;

  const { data: admins, error: adminError } = await db
    .from("user_organizations")
    .select("organization_id")
    .eq("role", "org_admin")
    .eq("status", "active")
    .in("organization_id", orgRows.map((o) => o.id));

  if (adminError) {
    throw new Error(`Failed to evaluate org_admin coverage: ${adminError.message}`);
  }

  const orgsWithAdmin = new Set((admins ?? []).map((a) => a.organization_id));
  const missingAdmin = orgRows.filter((o) => !orgsWithAdmin.has(o.id));
  if (missingAdmin.length === 0) return null;

  const { data: contacts, error: contactError } = await db
    .from("contacts")
    .select("organization_id")
    .in("organization_id", missingAdmin.map((o) => o.id))
    .is("archived_at", null);

  if (contactError) {
    throw new Error(`Failed to evaluate contact coverage: ${contactError.message}`);
  }

  const orgsWithContact = new Set((contacts ?? []).map((c) => c.organization_id));
  const readyToPromote = missingAdmin.filter((o) => orgsWithContact.has(o.id));
  const needsOutreach = missingAdmin.filter((o) => !orgsWithContact.has(o.id));

  return {
    ruleKey: "orgs_missing_admin",
    severity: readyToPromote.length > 0 ? "warning" : "info",
    message: `${missingAdmin.length} active org(s) have no org_admin — ${readyToPromote.length} already have a contact on file ready to promote, ${needsOutreach.length} need outreach first.`,
    details: {
      totalMissingAdmin: missingAdmin.length,
      readyToPromoteCount: readyToPromote.length,
      needsOutreachCount: needsOutreach.length,
      readyToPromote: readyToPromote.map((o) => ({ id: o.id, name: o.name, type: o.type })),
      needsOutreach: needsOutreach.map((o) => ({ id: o.id, name: o.name, type: o.type })),
    },
  };
}

/**
 * Idempotent immediate alert: raises a critical ops alert for the given candidate
 * only if no open/acknowledged alert with the same rule_key already exists.
 * Wrapped to never throw — alert infrastructure failure must not mask the caller's error.
 */
export async function raiseAlertIfNotOpen(candidate: CandidateAlert): Promise<void> {
  try {
    const readDb = createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (col: string, val: string) => {
            neq: (col: string, val: string) => Promise<{
              data: unknown[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };

    const { data } = await readDb
      .from("ops_alerts")
      .select("id")
      .eq("rule_key", candidate.ruleKey)
      .neq("status", "resolved");

    const existing = (data ?? []) as Array<{ id: string }>;
    if (existing.length > 0) return;

    await insertAlert(candidate);
  } catch {
    // Best-effort — do not let alert infrastructure failure mask the caller's error.
    console.error(`[ops] raiseAlertIfNotOpen failed for rule_key=${candidate.ruleKey}`);
  }
}

/**
 * Closes any open/acknowledged alerts for one rule key.
 *
 * The counterpart to raiseAlertIfNotOpen, for event-driven alerts whose
 * condition is cleared by a person doing something rather than by a candidate
 * check going quiet — the resolve sweep in evaluateOpsAlerts() only auto-closes
 * rule keys that its own candidates emit, so those alerts would otherwise sit
 * open forever. Same best-effort contract: never throws.
 */
export async function resolveAlertsByRuleKey(ruleKey: string): Promise<void> {
  try {
    const readDb = createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (
            col: string,
            val: string,
          ) => {
            neq: (
              col: string,
              val: string,
            ) => Promise<{
              data: unknown[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };

    const { data } = await readDb
      .from("ops_alerts")
      .select("id")
      .eq("rule_key", ruleKey)
      .neq("status", "resolved");

    for (const row of (data ?? []) as Array<{ id: string }>) {
      await resolveAlert(row.id, ruleKey);
    }
  } catch {
    console.error(`[ops] resolveAlertsByRuleKey failed for rule_key=${ruleKey}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Board process rules
//
// These watch the *process*, not the plumbing — the board's existing alerts
// (board_docx_export_errors, onedrive_sync_failed) only fire when a job
// breaks. These fire when the cadence slips: a meeting that never got closed
// out, no next meeting on the books, an action item past due, minutes never
// posted.
//
// To add another board rule: write an `evaluateBoardX()` returning a
// CandidateAlert or null, add its rule key to PERIODIC_RULE_KEYS above, and
// add the call to the array in evaluateCandidates(). Nothing else is wired by
// hand — the create/resolve sweep picks it up from there.
// ─────────────────────────────────────────────────────────────────────

/** Board settings live in app_settings alongside the other integration config. */
async function getBoardSettingNumber(key: string, fallback: number): Promise<number> {
  const db = createAdminClient();
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const parsed = Number(String(data?.value ?? "").replace(/"/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A meeting whose date has passed but is still "upcoming" — nobody closed it
 * out. Deliberately an alert rather than an auto-transition to "completed":
 * silently completing a meeting that has no minutes is exactly the drift this
 * is meant to catch.
 */
async function evaluateBoardMeetingNotClosedOut(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const today = todayString();

  const { data, error } = await db
    .from("board_meetings")
    .select("id, title, meeting_date")
    .eq("status", "upcoming")
    .lt("meeting_date", today)
    .order("meeting_date", { ascending: true });

  if (error) throw new Error(`Failed to evaluate board meeting closeout: ${error.message}`);

  const stale = data ?? [];
  if (stale.length === 0) return null;

  return {
    ruleKey: "board_meeting_not_closed_out",
    severity: "warning",
    message:
      stale.length === 1
        ? `Board meeting "${stale[0].title}" (${stale[0].meeting_date}) has passed but is still marked upcoming.`
        : `${stale.length} board meetings have passed but are still marked upcoming.`,
    details: {
      count: stale.length,
      meetings: stale.map((m) => ({ id: m.id, title: m.title, meetingDate: m.meeting_date })),
    },
  };
}

/** No future meeting on the books — the rule that enforces the monthly cadence. */
async function evaluateBoardNoUpcomingMeeting(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("board_meetings")
    .select("id")
    .eq("status", "upcoming")
    .gte("meeting_date", todayString())
    .limit(1);

  if (error) throw new Error(`Failed to evaluate upcoming board meetings: ${error.message}`);
  if ((data ?? []).length > 0) return null;

  return {
    ruleKey: "board_no_upcoming_meeting",
    severity: "warning",
    message: "No upcoming board meeting is scheduled.",
    details: {},
  };
}

/**
 * Applications whose vote lapsed and which are now stuck.
 *
 * A lapse is not a rejection — it means the deadline passed without 5 in
 * favour and without 5 against, so the applicant is meant to carry to the next
 * board meeting. But nothing automatic moves them there: `findApplicationsNeedingVote`
 * skips any application that already has a vote row, so a lapsed applicant
 * never gets a second vote, and there is no "your application lapsed" email.
 * Left alone they sit in pending_review indefinitely, having heard nothing —
 * and partner applicants have usually already paid for a booth.
 *
 * This alert is the tripwire until that path is built.
 */
async function evaluateBoardVoteLapsed(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data: lapsed, error } = await db
    .from("board_votes")
    .select("id, application_id, decided_at")
    .eq("status", "lapsed")
    .order("decided_at", { ascending: true });

  if (error || !lapsed?.length) return null;

  // Only those still awaiting review — a human may already have handled it.
  const { data: apps } = await db
    .from("signup_applications")
    .select("id, applicant_name, application_data, paid_amount_cents")
    .in(
      "id",
      lapsed.map((v) => v.application_id as string)
    )
    .eq("status", "pending_review");

  if (!apps?.length) return null;

  const stuck = apps.map((app) => {
    const data = app.application_data as Record<string, unknown> | null;
    return {
      applicationId: app.id as string,
      name:
        ((data?.company_name as string) || (app.applicant_name as string) || "Unnamed applicant").trim(),
      paidCents: (app.paid_amount_cents as number) ?? null,
    };
  });

  const paid = stuck.filter((s) => s.paidCents);

  return {
    ruleKey: "board_vote_lapsed_unresolved",
    severity: paid.length ? "critical" : "warning",
    message:
      (stuck.length === 1
        ? `${stuck[0].name}'s board vote lapsed and the application is still awaiting review.`
        : `${stuck.length} applications had their board vote lapse and are still awaiting review.`) +
      ` They have not been told anything and will not be re-voted automatically — put them on the next board meeting agenda.` +
      (paid.length ? ` ${paid.length} of them have already paid.` : ""),
    details: {
      count: stuck.length,
      paidCount: paid.length,
      oldestDecidedAt: lapsed[0].decided_at,
      applications: stuck,
    },
  };
}

/**
 * Board votes that carried but whose approval nobody has executed yet.
 *
 * Butler never approves an application itself — approveApplication() creates
 * the org, provisions logins, grants Circle access and sends invites, so a
 * human presses that button. This is the alert that stops a carried vote from
 * sitting unexecuted while the applicant waits.
 */
async function evaluateBoardVoteAwaitingExecution(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("board_votes")
    .select("id, application_id, decided_at")
    .eq("status", "carried")
    .is("executed_at", null)
    .order("decided_at", { ascending: true });

  if (error || !data?.length) return null;

  return {
    ruleKey: "board_vote_awaiting_execution",
    severity: "warning",
    message:
      data.length === 1
        ? `A board vote carried on ${data[0].decided_at?.slice(0, 10)} but the approval has not been executed yet.`
        : `${data.length} carried board votes are waiting for their approval to be executed.`,
    details: {
      count: data.length,
      oldestDecidedAt: data[0].decided_at,
      voteIds: data.map((v) => v.id),
      applicationIds: data.map((v) => v.application_id),
    },
  };
}

/**
 * Votes that ran past their deadline without the cron closing them.
 *
 * Means the hourly job is not running, or is erroring before it reaches the
 * close step — either way the board is looking at a post whose buttons no
 * longer do anything.
 */
async function evaluateBoardVoteNotClosed(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  // One hour of slack so this never fires on the gap between deadline and cron.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("board_votes")
    .select("id, closes_at")
    .eq("status", "open")
    .lt("closes_at", cutoff)
    .order("closes_at", { ascending: true });

  if (error || !data?.length) return null;

  return {
    ruleKey: "board_vote_not_closed",
    severity: "critical",
    message:
      `${data.length} board vote${data.length === 1 ? "" : "s"} passed the voting deadline over an hour ago ` +
      `and ${data.length === 1 ? "was" : "were"} never tallied — check /api/cron/board-votes.`,
    details: {
      count: data.length,
      oldestClosesAt: data[0].closes_at,
      voteIds: data.map((v) => v.id),
    },
  };
}

/**
 * The director roster no longer matches the bylaw board size.
 *
 * The 5-of-9 threshold is a constant, not a count. If the roster drifts, a
 * majority silently starts meaning something different, so voting is suspended
 * until this is reconciled.
 */
async function evaluateBoardRosterSize(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data, error } = await db.from("profiles").select("id").eq("global_role", "admin");
  if (error || !data) return null;
  if (data.length === EXPECTED_BOARD_SIZE) return null;

  return {
    ruleKey: "board_roster_size_mismatch",
    severity: "critical",
    message:
      `The board roster has ${data.length} directors (profiles.global_role='admin') but the bylaws fix it at ` +
      `${EXPECTED_BOARD_SIZE}. New partner votes are suspended until these agree — a wrong denominator changes what a majority means.`,
    details: { found: data.length, expected: EXPECTED_BOARD_SIZE },
  };
}

/** Action items past their due date and still not done. */
async function evaluateBoardActionItemOverdue(): Promise<CandidateAlert | null> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("board_action_items")
    .select("id, title, due_date, status, assignees")
    .in("status", ["open", "in_progress"])
    .not("due_date", "is", null)
    .lt("due_date", todayString())
    .order("due_date", { ascending: true });

  if (error) throw new Error(`Failed to evaluate board action items: ${error.message}`);

  const overdue = data ?? [];
  if (overdue.length === 0) return null;

  return {
    ruleKey: "board_action_item_overdue",
    severity: "warning",
    message:
      overdue.length === 1
        ? `Board action item "${overdue[0].title}" was due ${overdue[0].due_date} and is still open.`
        : `${overdue.length} board action items are past due.`,
    details: {
      count: overdue.length,
      oldestDueDate: overdue[0].due_date,
      items: overdue.map((i) => ({ id: i.id, title: i.title, dueDate: i.due_date, assignees: i.assignees })),
    },
  };
}

/**
 * Meetings that have happened but still have no minutes past the grace period.
 *
 * Keyed off the meeting *date*, not `status = 'completed'`. Status is manually
 * maintained and demonstrably isn't kept up (there are meetings with full
 * minutes still sitting at "upcoming"), so a status-gated rule would go quiet
 * exactly when the process is slipping. Cancelled meetings are excluded —
 * they're the one status transition that does get set deliberately.
 */
async function evaluateBoardMinutesOverdue(): Promise<CandidateAlert | null> {
  const db = createAdminClient();
  const graceDays = await getBoardSettingNumber("board_minutes_due_days", 14);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - graceDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { data, error } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, minutes_html")
    .neq("status", "cancelled")
    .lt("meeting_date", cutoffDate)
    .order("meeting_date", { ascending: true });

  if (error) throw new Error(`Failed to evaluate board minutes: ${error.message}`);

  const missing = (data ?? []).filter((m) => !m.minutes_html || m.minutes_html.trim() === "");
  if (missing.length === 0) return null;

  return {
    ruleKey: "board_minutes_overdue",
    severity: "warning",
    message:
      missing.length === 1
        ? `Minutes for "${missing[0].title}" (${missing[0].meeting_date}) are still not posted after ${graceDays} days.`
        : `${missing.length} completed board meetings have no minutes posted after ${graceDays} days.`,
    details: {
      count: missing.length,
      graceDays,
      meetings: missing.map((m) => ({ id: m.id, title: m.title, meetingDate: m.meeting_date })),
    },
  };
}

/**
 * A table's GRANTs and its RLS policies have started disagreeing.
 *
 * Postgres enforces both gates independently and has no notion of them being
 * inconsistent, so neither failure mode raises anything on its own — one is
 * silent, the other is loud but only at the moment somebody tries a write that
 * nothing in the app currently makes. This is the only place that opinion gets
 * formed. See supabase/migrations/20260820140000_db_access_drift_audit.sql.
 *
 * Returns an alert per affected table rather than one summary alert: a single
 * open alert would freeze its message at creation (see
 * [[feedback_ops_alert_message_goes_stale]]), so a second table drifting a week
 * later would never be mentioned anywhere.
 */
async function evaluateDbAccessDrift(): Promise<CandidateAlert[]> {
  const db = createAdminClient() as unknown as {
    rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { data, error } = await db.rpc("db_access_drift");

  if (error || !data) {
    // Don't silently swallow this — a rule that can't run is indistinguishable
    // from a rule that found nothing, which is the exact class of bug it exists
    // to catch.
    return [
      {
        ruleKey: "db_access_drift:audit_unavailable",
        severity: "warning",
        message:
          "The database access-drift audit could not run, so GRANT/policy drift is currently unmonitored.",
        details: { error: error?.message ?? "db_access_drift() returned no data" },
      },
    ];
  }

  const report = data as DbAccessDriftReport;

  return diffDbAccessDrift(report).map((finding): CandidateAlert => {
    if (finding.kind === "default_acl") {
      return {
        ruleKey: "db_access_drift:default_acl",
        severity: "critical",
        message:
          "The public schema's DEFAULT privileges changed. Every table created from now on gets a different set of grants, which silently changes whether its RLS policies are ever evaluated. This cannot happen through a migration in this repo — it was changed in the Supabase console or SQL editor.",
        details: { live: report.default_acl },
      };
    }

    if (finding.kind === "anon_writable") {
      return {
        ruleKey: `db_access_drift:anon_writable:${finding.table}`,
        severity: "critical",
        message: `Table "${finding.table}" is now writable with the anon key — it has an anon write GRANT and an unconditional RLS policy. The anon key ships in the browser bundle, so this is open to anyone on the internet.`,
        details: { table: finding.table, kind: "anon_writable" },
      };
    }

    return {
      ruleKey: `db_access_drift:silent_noop:${finding.table}`,
      severity: "warning",
      message: `Writes to "${finding.table}" (${finding.commands}) through the session client now match zero rows and report success anyway — \`authenticated\` holds the GRANT but no RLS policy allows the row. Write through createAdminClient() behind an app-layer auth check, or add a scoped policy.`,
      details: { table: finding.table, commands: finding.commands, kind: "silent_noop" },
    };
  });
}

async function evaluateCandidates(): Promise<CandidateAlert[]> {
  const checks = await Promise.all([
    evaluateConsecutiveRenewalFailures(),
    evaluateSchedulerInfeasible(),
    evaluateBillingFailureRate(),
    evaluateCircleBacklog(),
    evaluateWebhookBacklog(),
    evaluateSwapStaleConflicts(),
    evaluateAuthGuardDenySpike(),
    evaluateLoginRedirectLoop(),
    evaluateBootstrapRecoveryFailure(),
    evaluateLegalAcceptanceGap(),
    evaluateRetentionOverdue(),
    evaluateQBExportBacklog(),
    evaluateOrgsMissingAdmin(),
    evaluateBoardMeetingNotClosedOut(),
    evaluateBoardNoUpcomingMeeting(),
    evaluateBoardActionItemOverdue(),
    evaluateBoardMinutesOverdue(),
    evaluateBoardVoteAwaitingExecution(),
    evaluateBoardVoteLapsed(),
    evaluateBoardVoteNotClosed(),
    evaluateBoardRosterSize(),
  ]);

  // Flattened separately: every other check yields at most one candidate, but
  // access drift yields one per affected table.
  const driftChecks = await evaluateDbAccessDrift();

  return [
    ...checks.filter((item): item is CandidateAlert => Boolean(item)),
    ...driftChecks,
  ];
}

export async function evaluateOpsAlerts(): Promise<{
  success: boolean;
  activeRuleKeys: string[];
  createdCount: number;
  resolvedCount: number;
  error?: string;
}> {
  try {
    const candidates = await evaluateCandidates();
    const activeRuleKeys = new Set(candidates.map((candidate) => candidate.ruleKey));

    const db = createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          in: (column: string, values: string[]) => {
            neq: (column: string, value: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
          neq: (column: string, value: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };

    const existingRes = await db
      .from("ops_alerts")
      .select("id, rule_key, status")
      .neq("status", "resolved");

    if (existingRes.error) {
      throw new Error(`Failed to load existing ops alerts: ${existingRes.error.message}`);
    }

    const existing = (existingRes.data ?? []) as OpsAlertRow[];
    const existingByRule = new Map<string, OpsAlertRow[]>();
    for (const row of existing) {
      const list = existingByRule.get(row.rule_key) ?? [];
      list.push(row);
      existingByRule.set(row.rule_key, list);
    }

    let createdCount = 0;
    for (const candidate of candidates) {
      const alreadyOpen = (existingByRule.get(candidate.ruleKey) ?? []).length > 0;
      if (alreadyOpen) continue;
      await insertAlert(candidate);
      createdCount += 1;
    }

    let resolvedCount = 0;
    for (const [ruleKey, rows] of existingByRule.entries()) {
      if (activeRuleKeys.has(ruleKey)) continue;
      if (!isPeriodicRuleKey(ruleKey)) continue;
      for (const row of rows) {
        await resolveAlert(row.id, ruleKey);
        resolvedCount += 1;
      }
    }

    return {
      success: true,
      activeRuleKeys: [...activeRuleKeys],
      createdCount,
      resolvedCount,
    };
  } catch (error) {
    return {
      success: false,
      activeRuleKeys: [],
      createdCount: 0,
      resolvedCount: 0,
      error: error instanceof Error ? error.message : "Unknown alert evaluation error",
    };
  }
}
