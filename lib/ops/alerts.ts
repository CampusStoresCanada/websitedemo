import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";

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
  ]);

  return checks.filter((item): item is CandidateAlert => Boolean(item));
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
