import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import {
  acknowledgeOpsAlertAction,
  retryInvoiceChargeAction,
  skipCircleSyncItemAction,
  resolveCircleSyncItemAction,
  resolveOpsAlertAction,
  voidInvoiceAction,
  replayConferenceWebhookEventAction,
  replayStripeWebhookEventAction,
  retryCircleSyncItemAction,
  setOpsAlertTriageAction,
  runOpsJobNowAction,
  runOpsAlertEvaluationAction,
  deleteSchedulerRunAction,
  deleteBillingRunAction,
  retryQBExportAction,
  ignoreQBReconciliationItemAction,
} from "@/lib/actions/ops";
import { approveApplication, rejectApplication, resendApplicationInvite } from "@/lib/actions/applications";
import { Timestamp } from "@/components/ui/LocalDate";

export const metadata = {
  title: "Ops Health | Admin | Campus Stores Canada",
};

// Ops is an operational console; always render with fresh server data.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HealthLevel = "healthy" | "warning" | "critical";

type JobCard = {
  key: string;
  title: string;
  level: HealthLevel;
  lastRunAt: React.ReactNode;
  nextRunAt: React.ReactNode;
  summary: string;
};

type RenewalJobType = "reminder_run" | "charge_run" | "grace_check_run";

type RenewalRunRow = {
  id: string;
  job_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  orgs_processed: number | null;
  orgs_succeeded: number | null;
  orgs_failed: number | null;
};

type SchedulerRunRow = {
  id: string;
  status: "running" | "completed" | "failed" | "infeasible";
  run_mode: "draft" | "active" | "archived";
  started_at: string;
  completed_at: string | null;
  total_meetings_created: number | null;
};

type BillingRunRow = {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  total_items: number | null;
  successful_items: number | null;
  failed_items: number | null;
};

type StripeWebhookRow = {
  id: string;
  type: string;
  result: string;
  processed_at: string;
  error_message: string | null;
};

type ConferenceWebhookRow = {
  stripe_event_id: string;
  event_type: string;
  success: boolean;
  processed_at: string;
  error_message: string | null;
};

type OpsAlertRow = {
  id: string;
  rule_key: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  owner_id: string | null;
  due_at: string | null;
};

type AuditLogRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_type: string;
  created_at: string;
  details: Record<string, unknown>;
};

type OperationOutcome = {
  id: string;
  createdAt: string;
  action: string;
  success: boolean | null;
  message: string;
};

type AdminTransferRow = {
  id: string;
  organization_id: string;
  from_user_id: string;
  to_user_id: string | null;
  status: string;
  requested_at: string;
  timeout_at: string;
  reason: string | null;
};

type PendingApplicationRow = {
  id: string;
  application_type: string;
  applicant_name: string | null;
  status: string;
  created_at: string | null;
};

type PaymentFailureRow = {
  id: string;
  status: string;
  total_cents: number;
  due_date: string | null;
  created_at: string;
  organization_id: string;
  organization: {
    name: string | null;
    slug: string | null;
    email: string | null;
  } | null;
};

type QBExportFailureRow = {
  id: string;
  invoice_id: string;
  status: string;
  retry_count: number;
  error_message: string | null;
  created_at: string;
};

type QBReconPendingRow = {
  id: string;
  qbo_payment_id: string;
  amount_cents: number;
  currency: string;
  paid_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

type CircleSyncRow = {
  id: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
};

type ConferenceInstanceRow = {
  id: string;
  name: string;
  year: number;
  edition_code: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
};

type LegalVersionRow = {
  id: string;
  conference_id: string;
  document_type: string;
  version: number;
  effective_at: string;
  created_at: string;
};

type LegalAcceptanceRow = {
  id: string;
  user_id: string;
  legal_version_id: string;
  accepted_at: string;
};

type ConferenceRegistrationCoverageRow = {
  user_id: string;
  status: string;
};

type RetentionJobRow = {
  id: string;
  conference_id: string;
  policy_set_id: string | null;
  cutoff_at: string;
  records_purged: number;
  status: "completed" | "failed";
  executed_at: string;
  error_details: string | null;
};


function levelClasses(level: HealthLevel): string {
  if (level === "critical") return "bg-red-50 text-red-700 border-red-200";
  if (level === "warning") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function levelLabel(level: HealthLevel): string {
  if (level === "critical") return "Critical";
  if (level === "warning") return "Warning";
  return "Healthy";
}

function nextRunFromSimpleCron(
  cronExpr:
    | "0 11 * * *"
    | "0 12 * * *"
    | "0 13 * * *"
    | "0 14 * * *"
    | "0 * * * *"
    | "*/5 * * * *"
    | "*/15 * * * *"
): string {
  const now = new Date();
  const next = new Date(now);

  if (cronExpr === "*/5 * * * *" || cronExpr === "*/15 * * * *") {
    const step = cronExpr === "*/5 * * * *" ? 5 : 15;
    const minute = now.getMinutes();
    const mod = minute % step;
    const delta = mod === 0 ? step : step - mod;
    next.setMinutes(minute + delta, 0, 0);
    return next.toISOString();
  }

  if (cronExpr === "0 * * * *") {
    next.setHours(now.getHours() + 1, 0, 0, 0);
    return next.toISOString();
  }

  const targetHour =
    cronExpr === "0 11 * * *"
      ? 11
      : cronExpr === "0 12 * * *"
        ? 12
        : cronExpr === "0 13 * * *"
          ? 13
          : 14;
  next.setHours(targetHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function alertBadgeClasses(
  severity: "info" | "warning" | "critical"
): string {
  if (severity === "critical") return "bg-red-50 text-red-700";
  if (severity === "warning") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-[#D92327]";
}

function deriveRenewalLevel(run: RenewalRunRow | null): HealthLevel {
  if (!run) return "warning";
  if (run.status === "failed") return "critical";
  const failed = run.orgs_failed ?? 0;
  if (failed > 0) return "warning";
  return "healthy";
}

async function fetchLatestRenewalRun(jobType: RenewalJobType): Promise<RenewalRunRow | null> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("renewal_job_runs")
    .select(
      "id, job_type, status, started_at, completed_at, orgs_processed, orgs_succeeded, orgs_failed"
    )
    .eq("job_type", jobType)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as RenewalRunRow | null) ?? null;
}

type OpsPageProps = {
  searchParams?: Promise<{
    auditAction?: string;
    auditActor?: string;
    auditEntityType?: string;
    auditEntityId?: string;
    auditFrom?: string;
    auditTo?: string;
    auditPage?: string;
    alertStatus?: "all" | "active" | "resolved";
  }>;
};

export default async function AdminOpsPage({ searchParams }: OpsPageProps) {
  const params = (await searchParams) ?? {};
  const auditActionFilter = (params.auditAction ?? "").trim();
  const auditActorFilter = (params.auditActor ?? "").trim();
  const auditEntityTypeFilter = (params.auditEntityType ?? "").trim();
  const auditEntityIdFilter = (params.auditEntityId ?? "").trim();
  const auditFromFilter = (params.auditFrom ?? "").trim();
  const auditToFilter = (params.auditTo ?? "").trim();
  const auditPage = Math.max(1, Number(params.auditPage ?? "1") || 1);
  const AUDIT_PAGE_SIZE = 50;
  const alertStatusFilter = params.alertStatus ?? "active";
  const now = new Date();
  const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const adminClient = createAdminClient();

  const [
    reminderRun,
    chargeRun,
    graceRun,
    schedulerLatestRes,
    schedulerRecentRes,
    schedulerActiveCountRes,
    schedulerDraftCountRes,
    billingLatestRes,
    billingRecentRes,
    circlePendingCountRes,
    circleFailedCountRes,
    circleFailedItemsRes,
    transferPendingCountRes,
    stripeWebhookRes,
    conferenceWebhookRes,
    pendingAppsRes,
    failedInvoicesRes,
    qboReconPendingRes,
    qboExportFailedRes,
    qboExportPendingCountRes,
    authGuardDeniedRes,
    authGuardErrorRes,
    authRedirectLoopRes,
    authTelemetryWindowRes,
    latestRetentionRunRes,
    retentionRecentRunsRes,
    opsAlertsRes,
    auditLogRes,
    latestConferenceRes,
    activePolicySetRes,
  ] = await Promise.all([
    fetchLatestRenewalRun("reminder_run"),
    fetchLatestRenewalRun("charge_run"),
    fetchLatestRenewalRun("grace_check_run"),
    adminClient
      .from("scheduler_runs")
      .select("id, status, run_mode, started_at, completed_at, total_meetings_created")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("scheduler_runs")
      .select("id, status, run_mode, started_at, completed_at, total_meetings_created")
      .order("started_at", { ascending: false })
      .limit(10),
    adminClient
      .from("scheduler_runs")
      .select("id", { count: "exact", head: true })
      .eq("run_mode", "active"),
    adminClient
      .from("scheduler_runs")
      .select("id", { count: "exact", head: true })
      .eq("run_mode", "draft"),
    adminClient
      .from("billing_runs")
      .select(
        "id, status, started_at, completed_at, total_items, successful_items, failed_items"
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("billing_runs")
      .select(
        "id, status, started_at, completed_at, total_items, successful_items, failed_items"
      )
      .order("started_at", { ascending: false })
      .limit(10),
    adminClient
      .from("circle_sync_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "queued", "retrying"]),
    adminClient
      .from("circle_sync_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    adminClient
      .from("circle_sync_queue")
      .select(
        "id, operation, entity_type, entity_id, status, attempts, last_error, next_retry_at, created_at"
      )
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
    adminClient
      .from("admin_transfer_requests")
      .select("id, organization_id, from_user_id, to_user_id, status, requested_at, timeout_at, reason")
      .in("status", ["pending", "accepted", "auto_approved", "fallback_triggered"])
      .order("requested_at", { ascending: false })
      .limit(10),
    adminClient
      .from("stripe_webhook_events")
      .select("id, type, result, processed_at, error_message")
      .order("processed_at", { ascending: false })
      .limit(10),
    adminClient
      .from("conference_webhook_events")
      .select("stripe_event_id, event_type, success, processed_at, error_message")
      .order("processed_at", { ascending: false })
      .limit(10),
    adminClient
      .from("signup_applications")
      .select("id, application_type, applicant_name, status, created_at")
      .in("status", ["pending", "pending_review", "pending_verification", "approved"])
      .order("created_at", { ascending: false })
      .limit(12),
    adminClient
      .from("invoices")
      .select(
        "id, status, total_cents, due_date, created_at, organization_id, organization:organizations(name, slug, email)"
      )
      .in("status", ["failed", "overdue", "pending_settlement"])
      .order("created_at", { ascending: false })
      .limit(12),
    adminClient
      .from("qbo_reconciliation_queue")
      .select("id, qbo_payment_id, amount_cents, currency, paid_at, status, notes, created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(20),
    adminClient
      .from("qbo_export_queue")
      .select("id, invoice_id, status, retry_count, error_message, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
    adminClient
      .from("qbo_export_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "retrying", "processing"]),
    adminClient
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth_guard_denied")
      .gte("created_at", oneHourAgoIso),
    adminClient
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth_guard_error")
      .gte("created_at", oneHourAgoIso),
    adminClient
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth_login_redirect_loop")
      .gte("created_at", oneDayAgoIso),
    adminClient
      .from("audit_log")
      .select("action, created_at, details")
      .in("action", [
        "auth_guard_denied",
        "auth_guard_error",
        "auth_idle_timeout",
        "auth_bootstrap_recovery_failed",
        "auth_login_redirect_loop",
      ])
      .gte("created_at", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1000),
    adminClient
      .from("retention_jobs")
      .select(
        "id, conference_id, policy_set_id, cutoff_at, records_purged, status, executed_at, error_details"
      )
      .order("executed_at", { ascending: false })
      .limit(1),
    adminClient
      .from("retention_jobs")
      .select(
        "id, conference_id, policy_set_id, cutoff_at, records_purged, status, executed_at, error_details"
      )
      .order("executed_at", { ascending: false })
      .limit(10),
    adminClient
      .from("ops_alerts")
      .select("id, rule_key, severity, status, message, created_at, acknowledged_at, resolved_at, owner_id, due_at")
      .order("created_at", { ascending: false })
      .limit(50),
    adminClient
      .from("audit_log")
      .select("id, action, entity_type, entity_id, actor_id, actor_type, details, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    adminClient
      .from("conference_instances")
      .select("id, name, year, edition_code, status, start_date, end_date")
      .order("year", { ascending: false })
      .order("edition_code", { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("policy_sets")
      .select("id")
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const schedulerLatest = (schedulerLatestRes.data as SchedulerRunRow | null) ?? null;
  const schedulerRecentRuns = (schedulerRecentRes.data as SchedulerRunRow[] | null) ?? [];
  const billingLatest = (billingLatestRes.data as BillingRunRow | null) ?? null;
  const billingRecentRuns = (billingRecentRes.data as BillingRunRow[] | null) ?? [];

  const schedulerLevel: HealthLevel = !schedulerLatest
    ? "warning"
    : schedulerLatest.status === "failed" || schedulerLatest.status === "infeasible"
      ? "critical"
      : schedulerLatest.status === "running"
        ? "warning"
        : "healthy";

  const billingLevel: HealthLevel = !billingLatest
    ? "warning"
    : billingLatest.status === "failed"
      ? "critical"
      : (billingLatest.failed_items ?? 0) > 0
        ? "warning"
        : "healthy";

  const circlePendingCount = circlePendingCountRes.count ?? 0;
  const circleFailedCount = circleFailedCountRes.count ?? 0;
  const circleLevel: HealthLevel = circleFailedCount > 0 ? "critical" : circlePendingCount > 50 ? "warning" : "healthy";

  const adminTransfers = (transferPendingCountRes.data ?? []) as AdminTransferRow[];
  const transferPendingCount = adminTransfers.filter((t) => t.status === "pending").length;
  const transferLevel: HealthLevel = transferPendingCount > 5 ? "warning" : "healthy";
  const authGuardDeniedLastHour = authGuardDeniedRes.count ?? 0;
  const authGuardErrorsLastHour = authGuardErrorRes.count ?? 0;
  const authRedirectLoopsLastDay = authRedirectLoopRes.count ?? 0;
  const authTelemetryRows = (authTelemetryWindowRes.data ?? []) as Array<{
    action: string;
    created_at: string;
    details: Record<string, unknown> | null;
  }>;
  const oneHourAgoTs = now.getTime() - 60 * 60 * 1000;
  const twoHoursAgoTs = now.getTime() - 2 * 60 * 60 * 1000;
  let idleTimeoutCurrentHour = 0;
  let idleTimeoutPreviousHour = 0;
  const idleTimeoutByRoleCurrent: Record<string, number> = {};
  const bootstrapRecoveryCurrentHour = authTelemetryRows.filter((row) => {
    return (
      row.action === "auth_bootstrap_recovery_failed" &&
      new Date(row.created_at).getTime() >= oneHourAgoTs
    );
  }).length;
  for (const row of authTelemetryRows) {
    if (row.action !== "auth_idle_timeout") continue;
    const ts = new Date(row.created_at).getTime();
    const role =
      row.details && typeof row.details.role === "string"
        ? row.details.role
        : "unknown";
    if (ts >= oneHourAgoTs) {
      idleTimeoutCurrentHour += 1;
      idleTimeoutByRoleCurrent[role] = (idleTimeoutByRoleCurrent[role] ?? 0) + 1;
      continue;
    }
    if (ts >= twoHoursAgoTs) {
      idleTimeoutPreviousHour += 1;
    }
  }
  const latestRetentionRun =
    ((latestRetentionRunRes.data as RetentionJobRow[] | null)?.[0] ?? null);
  const retentionRecentRuns =
    (retentionRecentRunsRes.data as RetentionJobRow[] | null) ?? [];
  const authLevel: HealthLevel =
    authRedirectLoopsLastDay > 0 || authGuardErrorsLastHour > 10
      ? "critical"
      : authGuardDeniedLastHour > 25
        ? "warning"
        : "healthy";

  const cards: JobCard[] = [
    {
      key: "renewal-reminders",
      title: "Renewal Reminders",
      level: deriveRenewalLevel(reminderRun),
      lastRunAt: <Timestamp iso={reminderRun?.started_at} format="compact" />,
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("0 11 * * *")} format="compact" />,
      summary: reminderRun
        ? `Status: ${reminderRun.status}. Processed ${reminderRun.orgs_processed ?? 0}, failed ${reminderRun.orgs_failed ?? 0}.`
        : "No reminder runs yet.",
    },
    {
      key: "renewal-charges",
      title: "Renewal Charges",
      level: deriveRenewalLevel(chargeRun),
      lastRunAt: <Timestamp iso={chargeRun?.started_at} format="compact" />,
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("0 12 * * *")} format="compact" />,
      summary: chargeRun
        ? `Status: ${chargeRun.status}. Succeeded ${chargeRun.orgs_succeeded ?? 0}, failed ${chargeRun.orgs_failed ?? 0}.`
        : "No charge runs yet.",
    },
    {
      key: "grace-transitions",
      title: "Grace Transitions",
      level: deriveRenewalLevel(graceRun),
      lastRunAt: <Timestamp iso={graceRun?.started_at} format="compact" />,
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("0 13 * * *")} format="compact" />,
      summary: graceRun
        ? `Status: ${graceRun.status}. Processed ${graceRun.orgs_processed ?? 0}, failed ${graceRun.orgs_failed ?? 0}.`
        : "No grace transition runs yet.",
    },
    {
      key: "circle-sync",
      title: "Circle Sync",
      level: circleLevel,
      lastRunAt: "Queue-based",
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("*/5 * * * *")} format="compact" />,
      summary: `Pending: ${circlePendingCount}. Failed: ${circleFailedCount}.`,
    },
    {
      key: "circle-cutover",
      title: "Circle Cutover",
      level: circleFailedCount > 0 ? "warning" : "healthy",
      lastRunAt: "Live telemetry",
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("*/15 * * * *")} format="compact" />,
      summary:
        circleFailedCount > 0
          ? `Cutover drift signals detected in sync failures (${circleFailedCount}).`
          : "No cutover drift signals from current sync telemetry.",
    },
    {
      key: "scheduler",
      title: "Scheduler",
      level: schedulerLevel,
      lastRunAt: <Timestamp iso={schedulerLatest?.started_at} format="compact" />,
      nextRunAt: "On-demand (manual or automation-driven)",
      summary: schedulerLatest
        ? `Latest ${schedulerLatest.run_mode}/${schedulerLatest.status}. Meetings: ${schedulerLatest.total_meetings_created ?? 0}. Active runs: ${schedulerActiveCountRes.count ?? 0}, drafts: ${schedulerDraftCountRes.count ?? 0}.`
        : "No scheduler runs yet.",
    },
    {
      key: "billing-runs",
      title: "Billing Runs",
      level: billingLevel,
      lastRunAt: <Timestamp iso={billingLatest?.started_at} format="compact" />,
      nextRunAt: "On-demand / board-triggered",
      summary: billingLatest
        ? `Status: ${billingLatest.status}. Successful items: ${billingLatest.successful_items ?? 0}/${billingLatest.total_items ?? 0}. Failed: ${billingLatest.failed_items ?? 0}.`
        : "No billing runs yet.",
    },
    {
      key: "qb-reconciliation",
      title: "QB Reconciliation",
      level: "warning",
      lastRunAt: "Not yet instrumented",
      nextRunAt: "Dependency pending",
      summary:
        "QuickBooks reconciliation queue telemetry is pending instrumentation in this phase.",
    },
    {
      key: "retention-purge",
      title: "Retention Purge",
      level:
        !latestRetentionRun
          ? "warning"
          : latestRetentionRun.status === "failed"
            ? "critical"
            : "healthy",
      lastRunAt: <Timestamp iso={latestRetentionRun?.executed_at} format="compact" />,
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("0 14 * * *")} format="compact" />,
      summary: latestRetentionRun
        ? `Latest status: ${latestRetentionRun.status}. Records purged: ${latestRetentionRun.records_purged}.`
        : "No retention runs recorded yet.",
    },
    {
      key: "admin-transfers",
      title: "Admin Transfers",
      level: transferLevel,
      lastRunAt: "Live count",
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("0 * * * *")} format="compact" />,
      summary: `Pending transfer requests: ${transferPendingCount}.`,
    },
    {
      key: "auth-session-health",
      title: "Auth / Session Health",
      level: authLevel,
      lastRunAt: "Telemetry window",
      nextRunAt: <Timestamp iso={nextRunFromSimpleCron("*/15 * * * *")} format="compact" />,
      summary: `Last 1h guard denies: ${authGuardDeniedLastHour}. Guard errors: ${authGuardErrorsLastHour}. Last 24h redirect loops: ${authRedirectLoopsLastDay}.`,
    },
  ];

  const stripeEvents = (stripeWebhookRes.data ?? []) as StripeWebhookRow[];
  const conferenceEvents = (conferenceWebhookRes.data ?? []) as ConferenceWebhookRow[];
  const allOpsAlerts = (opsAlertsRes.data ?? []) as OpsAlertRow[];
  const auditLogsAll = (auditLogRes.data ?? []) as AuditLogRow[];
  const pendingApplications = (pendingAppsRes.data ?? []) as PendingApplicationRow[];
  const paymentFailures = (failedInvoicesRes.data ?? []) as PaymentFailureRow[];
  const qbReconPendingRows = (qboReconPendingRes.data ?? []) as QBReconPendingRow[];
  const qboExportFailedRows = (qboExportFailedRes.data ?? []) as QBExportFailureRow[];
  const qboExportPendingCount = qboExportPendingCountRes.count ?? 0;
  const failedSyncItems = (circleFailedItemsRes.data ?? []) as CircleSyncRow[];
  const latestConference =
    (latestConferenceRes.data as ConferenceInstanceRow | null) ?? null;
  const retentionPolicyValues: Array<{ key: string; value_json: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  const activePolicySet = activePolicySetRes.data as Record<string, any> | null;
  if (activePolicySet?.id) {
    const { data: retentionRows } = await adminClient
      .from("policy_values")
      .select("key, value_json")
      .eq("policy_set_id", activePolicySet.id)
      .like("key", "retention.%")
      .order("key", { ascending: true });

    const seenKeys = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (retentionRows ?? []) as Record<string, any>[]) {
      if (seenKeys.has(row.key)) continue;
      seenKeys.add(row.key);
      retentionPolicyValues.push({
        key: row.key,
        value_json: row.value_json,
      });
    }
  }

  const latestLegalVersionsByType = new Map<string, LegalVersionRow>();
  const legalCoverageRows: Array<{
    documentType: string;
    version: number;
    effectiveAt: string;
    acceptedUsers: number;
    coveragePct: number;
  }> = [];
  let overallLegalCoveragePct = 0;
  let requiredUserCount = 0;

  if (latestConference) {
    const [legalVersionsRes, registrationsRes] = await Promise.all([
      adminClient
        .from("conference_legal_versions")
        .select("id, conference_id, document_type, version, effective_at, created_at")
        .eq("conference_id", latestConference.id)
        .lte("effective_at", new Date().toISOString())
        .order("document_type", { ascending: true })
        .order("version", { ascending: false }),
      adminClient
        .from("conference_registrations")
        .select("user_id, status")
        .eq("conference_id", latestConference.id)
        .in("status", ["submitted", "confirmed"]),
    ]);

    const legalVersions = (legalVersionsRes.data ?? []) as LegalVersionRow[];
    const registrationRows = (registrationsRes.data ??
      []) as ConferenceRegistrationCoverageRow[];
    const requiredUsers = new Set(registrationRows.map((row) => row.user_id));
    requiredUserCount = requiredUsers.size;

    for (const row of legalVersions) {
      if (!latestLegalVersionsByType.has(row.document_type)) {
        latestLegalVersionsByType.set(row.document_type, row);
      }
    }

    const latestLegalVersionIds = [...latestLegalVersionsByType.values()].map(
      (row) => row.id
    );

    if (latestLegalVersionIds.length > 0) {
      const acceptancesRes = await adminClient
        .from("legal_acceptances")
        .select("id, user_id, legal_version_id, accepted_at")
        .in("legal_version_id", latestLegalVersionIds);
      const acceptances = (acceptancesRes.data ?? []) as LegalAcceptanceRow[];

      for (const doc of latestLegalVersionsByType.values()) {
        const acceptedUsers = new Set(
          acceptances
            .filter((acc) => acc.legal_version_id === doc.id)
            .map((acc) => acc.user_id)
            .filter((userId) => requiredUsers.has(userId))
        );
        const coveragePct =
          requiredUserCount > 0 ? (acceptedUsers.size / requiredUserCount) * 100 : 0;
        legalCoverageRows.push({
          documentType: doc.document_type,
          version: doc.version,
          effectiveAt: doc.effective_at,
          acceptedUsers: acceptedUsers.size,
          coveragePct,
        });
      }

      const acceptedByUser = new Map<string, Set<string>>();
      for (const row of acceptances) {
        if (!requiredUsers.has(row.user_id)) continue;
        const s = acceptedByUser.get(row.user_id) ?? new Set<string>();
        s.add(row.legal_version_id);
        acceptedByUser.set(row.user_id, s);
      }

      const requiredVersionIds = new Set(latestLegalVersionIds);
      let fullyCoveredUsers = 0;
      for (const userId of requiredUsers.values()) {
        const acceptedSet = acceptedByUser.get(userId) ?? new Set<string>();
        const hasAll = [...requiredVersionIds].every((id) => acceptedSet.has(id));
        if (hasAll) fullyCoveredUsers += 1;
      }
      overallLegalCoveragePct =
        requiredUserCount > 0 ? (fullyCoveredUsers / requiredUserCount) * 100 : 0;
    }
  }

  cards.push({
    key: "legal-acceptance-health",
    title: "Legal Acceptance Health",
    level:
      requiredUserCount === 0
        ? "warning"
        : overallLegalCoveragePct < 90
          ? "warning"
          : "healthy",
    lastRunAt: "Live coverage",
    nextRunAt: nextRunFromSimpleCron("*/15 * * * *"),
    summary:
      requiredUserCount === 0
        ? "No required conference users found for legal coverage computation."
        : `Overall legal acceptance coverage: ${overallLegalCoveragePct.toFixed(1)}% (${requiredUserCount} required users).`,
  });

  const activeOpsAlerts = allOpsAlerts.filter((row) => row.status !== "resolved");
  const resolvedOpsAlerts = allOpsAlerts.filter((row) => row.status === "resolved");
  const displayedAlerts =
    alertStatusFilter === "all"
      ? allOpsAlerts
      : alertStatusFilter === "resolved"
        ? resolvedOpsAlerts
        : activeOpsAlerts;

  const lastEvaluationRun = auditLogsAll.find(
    (row) =>
      row.action === "ops_alert_evaluation_run" ||
      row.action === "ops_alert_evaluation_cron_run"
  );
  const lastEvaluationDetails =
    lastEvaluationRun && typeof lastEvaluationRun.details === "object"
      ? (lastEvaluationRun.details as Record<string, unknown>)
      : null;
  const operationOutcomeActions = new Set([
    "ops_job_manual_run",
    "circle_sync_retry_request",
    "circle_sync_resolve_request",
    "circle_sync_skip_request",
    "invoice_retry_charge_request",
    "invoice_void_request",
    "stripe_webhook_replay_attempt",
    "conference_webhook_replay_attempt",
    "swap_request_commit",
  ]);
  const operationOutcomes: OperationOutcome[] = auditLogsAll
    .filter((row) => operationOutcomeActions.has(row.action))
    .slice(0, 12)
    .map((row) => {
      const details =
        row.details && typeof row.details === "object"
          ? (row.details as Record<string, unknown>)
          : {};
      const success =
        typeof details.success === "boolean" ? details.success : null;
      const message =
        typeof details.error === "string"
          ? details.error
          : typeof details.reason === "string"
            ? details.reason
            : "Operation recorded.";
      return {
        id: row.id,
        createdAt: row.created_at,
        action: row.action,
        success,
        message,
      };
    });

  const auditFromDate = auditFromFilter ? new Date(auditFromFilter) : null;
  const auditToDate = auditToFilter ? new Date(auditToFilter) : null;

  const auditLogs = auditLogsAll.filter((row) => {
    const actionOk = auditActionFilter
      ? row.action.toLowerCase().includes(auditActionFilter.toLowerCase())
      : true;
    const actorOk = auditActorFilter
      ? (row.actor_id ?? "").toLowerCase().includes(auditActorFilter.toLowerCase())
      : true;
    const entityTypeOk = auditEntityTypeFilter
      ? (row.entity_type ?? "")
          .toLowerCase()
          .includes(auditEntityTypeFilter.toLowerCase())
      : true;
    const entityIdOk = auditEntityIdFilter
      ? (row.entity_id ?? "")
          .toLowerCase()
          .includes(auditEntityIdFilter.toLowerCase())
      : true;
    const createdAt = new Date(row.created_at);
    const fromOk = auditFromDate ? createdAt >= auditFromDate : true;
    const toOk = auditToDate ? createdAt <= auditToDate : true;
    return actionOk && actorOk && entityTypeOk && entityIdOk && fromOk && toOk;
  });
  const auditTotalPages = Math.max(
    1,
    Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE)
  );
  const normalizedAuditPage = Math.min(auditPage, auditTotalPages);
  const auditStart = (normalizedAuditPage - 1) * AUDIT_PAGE_SIZE;
  const pagedAuditLogs = auditLogs.slice(auditStart, auditStart + AUDIT_PAGE_SIZE);

  const baseAuditParams = new URLSearchParams();
  if (auditActionFilter) baseAuditParams.set("auditAction", auditActionFilter);
  if (auditActorFilter) baseAuditParams.set("auditActor", auditActorFilter);
  if (auditEntityTypeFilter) baseAuditParams.set("auditEntityType", auditEntityTypeFilter);
  if (auditEntityIdFilter) baseAuditParams.set("auditEntityId", auditEntityIdFilter);
  if (auditFromFilter) baseAuditParams.set("auditFrom", auditFromFilter);
  if (auditToFilter) baseAuditParams.set("auditTo", auditToFilter);
  if (alertStatusFilter !== "active") baseAuditParams.set("alertStatus", alertStatusFilter);

  const failedStripe = stripeEvents.filter((row) => row.result !== "success").length;
  const failedConference = conferenceEvents.filter((row) => !row.success).length;
  const settlementAtRisk = paymentFailures.filter((row) => {
    if (row.status !== "pending_settlement" || !row.due_date) return false;
    const due = new Date(row.due_date).getTime();
    const daysUntilDue = (due - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilDue <= 3;
  });
  const qbBacklogCount = qbReconPendingRows.length;
  const qbCard = cards.find((card) => card.key === "qb-reconciliation");
  if (qbCard) {
    qbCard.level = qboExportFailedRows.length > 0 ? "critical" : qbBacklogCount > 0 || settlementAtRisk.length > 0 ? "warning" : "healthy";
    qbCard.lastRunAt = "Queue-based";
    qbCard.nextRunAt = nextRunFromSimpleCron("*/15 * * * *");
    qbCard.summary = `Export pending: ${qboExportPendingCount}. Export failed: ${qboExportFailedRows.length}. Recon pending review: ${qbBacklogCount}. Settlement at risk: ${settlementAtRisk.length}.`;
  }

  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ops Health</h1>
          <p className="mt-2 text-sm text-gray-600">
            Central operational status for automated jobs and integration health.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await runOpsAlertEvaluationAction();
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Run Alert Evaluation
          </button>
        </form>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Alert Lifecycle</h2>
            <p className="mt-1 text-sm text-gray-600">
              Last evaluator run: <Timestamp iso={lastEvaluationRun?.created_at} />{" "}
              {lastEvaluationRun
                ? `(${lastEvaluationRun.action === "ops_alert_evaluation_cron_run" ? "cron" : "manual"})`
                : ""}
            </p>
            {lastEvaluationDetails ? (
              <p className="mt-1 text-xs text-gray-500">
                Created: {String(lastEvaluationDetails.createdCount ?? 0)} · Resolved:{" "}
                {String(lastEvaluationDetails.resolvedCount ?? 0)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <a
              href="/admin/ops?alertStatus=active"
              className={`rounded-md border px-2 py-1 ${
                alertStatusFilter === "active"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              Active ({activeOpsAlerts.length})
            </a>
            <a
              href="/admin/ops?alertStatus=resolved"
              className={`rounded-md border px-2 py-1 ${
                alertStatusFilter === "resolved"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              Resolved ({resolvedOpsAlerts.length})
            </a>
            <a
              href="/admin/ops?alertStatus=all"
              className={`rounded-md border px-2 py-1 ${
                alertStatusFilter === "all"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              All ({allOpsAlerts.length})
            </a>
          </div>
        </div>

        <div className="mt-4 space-y-2">
        {displayedAlerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            No alerts in this view.
          </div>
        ) : (
          displayedAlerts.map((alert) => (
            <article key={alert.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${alertBadgeClasses(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {alert.status}
                  </span>
                  <span className="text-xs text-gray-500">{alert.rule_key}</span>
                </div>
                <span className="text-xs text-gray-500"><Timestamp iso={alert.created_at} /></span>
              </div>

              <p className="mt-2 text-sm text-gray-900">{alert.message}</p>
              <p className="mt-1 text-xs text-gray-500">
                Owner: {alert.owner_id ?? "Unassigned"} · Due: <Timestamp iso={alert.due_at} /> ·
                Acknowledged: <Timestamp iso={alert.acknowledged_at} /> · Resolved:{" "}
                <Timestamp iso={alert.resolved_at} />
              </p>

              <div className="mt-3 flex gap-2">
                {alert.status === "open" ? (
                  <form
                    action={async () => {
                      "use server";
                      await acknowledgeOpsAlertAction(alert.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Acknowledge
                    </button>
                  </form>
                ) : null}

                {alert.status !== "resolved" ? (
                  <form
                    action={async () => {
                      "use server";
                      await resolveOpsAlertAction(alert.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Resolve
                    </button>
                  </form>
                ) : null}
              </div>
              {alert.status !== "resolved" ? (
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const dueAtRaw = String(formData.get("dueAt") ?? "");
                    await setOpsAlertTriageAction(alert.id, dueAtRaw || null);
                  }}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <label className="text-xs text-gray-600">
                    Due At
                    <input
                      type="datetime-local"
                      name="dueAt"
                      className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Assign To Me + Set Due
                  </button>
                </form>
              ) : null}
            </article>
          ))
        )}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Manual Operations</h2>
        <p className="mt-1 text-sm text-gray-600">
          Run maintenance jobs on-demand. Every run requires a reason and is audit logged.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {[
            { key: "renewal_reminders", label: "Run Renewal Reminders" },
            { key: "renewal_charge", label: "Run Renewal Charge" },
            { key: "grace_check", label: "Run Grace Check" },
            { key: "circle_sync", label: "Run Circle Sync Queue" },
            { key: "ops_alert_eval", label: "Run Ops Alert Evaluation" },
            { key: "retention_purge", label: "Run Retention Purge" },
            { key: "qbo_export", label: "Run QB Export" },
            { key: "qbo_reconcile", label: "Run QB Reconcile" },
          ].map((job) => (
            <form
              key={job.key}
              action={async (formData: FormData) => {
                "use server";
                const reason = String(formData.get("reason") ?? "");
                await runOpsJobNowAction(
                  job.key as
                    | "renewal_reminders"
                    | "renewal_charge"
                    | "grace_check"
                    | "circle_sync"
                    | "ops_alert_eval"
                    | "retention_purge"
                    | "qbo_export"
                    | "qbo_reconcile",
                  reason
                );
              }}
              className="rounded-lg border border-gray-100 p-3"
            >
              <p className="text-sm font-medium text-gray-900">{job.label}</p>
              <label className="mt-2 block text-xs text-gray-600">
                Reason
                <input
                  name="reason"
                  type="text"
                  required
                  minLength={8}
                  placeholder="Why are you running this now?"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" required />
                I acknowledge idempotency limits for this operation.
              </label>
              <button
                type="submit"
                className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Run Now
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article key={card.key} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">{card.title}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${levelClasses(card.level)}`}
              >
                {levelLabel(card.level)}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">Last run: {card.lastRunAt}</p>
            <p className="mt-1 text-xs text-gray-500">Next run: {card.nextRunAt}</p>
            <p className="mt-2 text-sm text-gray-700">{card.summary}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Run Cleanup</h2>
        <p className="mt-1 text-sm text-gray-600">
          Delete failed/bad historical runs with audit reason. Active scheduler runs and any running run cannot be deleted.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-gray-100 p-3">
            <h3 className="text-sm font-semibold text-gray-900">Scheduler Runs</h3>
            <ul className="mt-2 space-y-2">
              {schedulerRecentRuns.length === 0 ? (
                <li className="text-sm text-gray-500">No scheduler runs found.</li>
              ) : (
                schedulerRecentRuns.map((run) => (
                  <li key={run.id} className="rounded-md border border-gray-100 p-2 text-sm">
                    <p className="font-medium text-gray-900">
                      {run.run_mode}/{run.status}
                    </p>
                    <p className="text-xs text-gray-600">
                      <Timestamp iso={run.started_at} /> • Meetings: {run.total_meetings_created ?? 0}
                    </p>
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        const reason = String(formData.get("reason") ?? "");
                        await deleteSchedulerRunAction(run.id, reason);
                      }}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        name="reason"
                        required
                        minLength={8}
                        placeholder="Reason for delete"
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={run.status === "running" || run.run_mode === "active"}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </form>
                  </li>
                ))
              )}
            </ul>
          </article>
          <article className="rounded-lg border border-gray-100 p-3">
            <h3 className="text-sm font-semibold text-gray-900">Billing Runs</h3>
            <ul className="mt-2 space-y-2">
              {billingRecentRuns.length === 0 ? (
                <li className="text-sm text-gray-500">No billing runs found.</li>
              ) : (
                billingRecentRuns.map((run) => (
                  <li key={run.id} className="rounded-md border border-gray-100 p-2 text-sm">
                    <p className="font-medium text-gray-900">{run.status}</p>
                    <p className="text-xs text-gray-600">
                      <Timestamp iso={run.started_at} /> • Failed: {run.failed_items ?? 0}/{run.total_items ?? 0}
                    </p>
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        const reason = String(formData.get("reason") ?? "");
                        await deleteBillingRunAction(run.id, reason);
                      }}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        name="reason"
                        required
                        minLength={8}
                        placeholder="Reason for delete"
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={run.status === "running"}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </form>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Auth / Session Anomalies</h2>
        <p className="mt-1 text-sm text-gray-600">
          Baseline vs current window telemetry for auth/session anomalies with thresholds.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Guard Denies (1h)</p>
            <p className="mt-1 text-gray-700">{authGuardDeniedLastHour}</p>
            <p className="mt-1 text-xs text-gray-500">Warning threshold: &gt; 25 / hour</p>
          </article>
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Guard Errors (1h)</p>
            <p className="mt-1 text-gray-700">{authGuardErrorsLastHour}</p>
            <p className="mt-1 text-xs text-gray-500">Critical threshold: &gt; 10 / hour</p>
          </article>
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Redirect Loops (24h)</p>
            <p className="mt-1 text-gray-700">{authRedirectLoopsLastDay}</p>
            <p className="mt-1 text-xs text-gray-500">Critical threshold: any occurrence</p>
          </article>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Idle Timeouts (Current vs Baseline)</p>
            <p className="mt-1 text-gray-700">
              Current 1h: {idleTimeoutCurrentHour} • Previous 1h: {idleTimeoutPreviousHour}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Role breakdown (current 1h):{" "}
              {Object.keys(idleTimeoutByRoleCurrent).length === 0
                ? "none"
                : Object.entries(idleTimeoutByRoleCurrent)
                    .map(([role, count]) => `${role}: ${count}`)
                    .join(", ")}
            </p>
          </article>
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Bootstrap Recovery Failures (1h)</p>
            <p className="mt-1 text-gray-700">{bootstrapRecoveryCurrentHour}</p>
            <p className="mt-1 text-xs text-gray-500">Any non-zero indicates auth bootstrap instability.</p>
          </article>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Retention Runs</h2>
        <p className="mt-1 text-sm text-gray-600">
          Recent retention purge executions and outcomes.
        </p>
        <ul className="mt-3 space-y-2">
          {retentionRecentRuns.length === 0 ? (
            <li className="text-sm text-gray-500">No retention runs recorded.</li>
          ) : (
            retentionRecentRuns.map((run) => (
              <li key={run.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <p className="font-medium text-gray-900">
                  {run.status} • Purged {run.records_purged} • <Timestamp iso={run.executed_at} />
                </p>
                <p className="text-xs text-gray-600">
                  Conference: {run.conference_id} • Cutoff: <Timestamp iso={run.cutoff_at} /> • Policy Set:{" "}
                  {run.policy_set_id ?? "n/a"}
                </p>
                {run.error_details ? (
                  <p className="mt-1 text-xs text-red-700">{run.error_details}</p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Webhook Monitor</h2>
        <p className="mt-1 text-sm text-gray-600">
          Stripe failures in last {stripeEvents.length}: {failedStripe}. Conference webhook failures in last {conferenceEvents.length}: {failedConference}.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Stripe Webhook Events</h3>
            <ul className="mt-2 space-y-2">
              {stripeEvents.length === 0 ? (
                <li className="text-sm text-gray-500">No events recorded.</li>
              ) : (
                stripeEvents.slice(0, 5).map((row) => (
                  <li key={row.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                    <p className="font-medium text-gray-900">{row.type}</p>
                    <p className="text-gray-600"><Timestamp iso={row.processed_at} /> • {row.result}</p>
                    {row.error_message ? <p className="text-red-700">{row.error_message}</p> : null}
                    {row.result !== "success" ? (
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const reason = String(formData.get("reason") ?? "");
                          await replayStripeWebhookEventAction(row.id, reason);
                        }}
                        className="mt-2 flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          name="reason"
                          required
                          minLength={8}
                          placeholder="Reason for replay"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <label className="flex items-center gap-1 text-[11px] text-gray-600">
                          <input type="checkbox" required />
                          Idempotency acknowledged
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Replay
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Conference Webhook Events</h3>
            <ul className="mt-2 space-y-2">
              {conferenceEvents.length === 0 ? (
                <li className="text-sm text-gray-500">No events recorded.</li>
              ) : (
                conferenceEvents.slice(0, 5).map((row) => (
                  <li key={`${row.stripe_event_id}:${row.event_type}`} className="rounded-lg border border-gray-100 p-2 text-sm">
                    <p className="font-medium text-gray-900">{row.event_type}</p>
                    <p className="text-gray-600"><Timestamp iso={row.processed_at} /> • {row.success ? "success" : "failed"}</p>
                    {row.error_message ? <p className="text-red-700">{row.error_message}</p> : null}
                    {!row.success ? (
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const reason = String(formData.get("reason") ?? "");
                          await replayConferenceWebhookEventAction(
                            row.stripe_event_id,
                            reason
                          );
                        }}
                        className="mt-2 flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          name="reason"
                          required
                          minLength={8}
                          placeholder="Reason for replay"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <label className="flex items-center gap-1 text-[11px] text-gray-600">
                          <input type="checkbox" required />
                          Idempotency acknowledged
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Replay
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Sync Conflict Log</h2>
        <p className="mt-1 text-sm text-gray-600">
          Failed Circle sync queue items that need retry or manual remediation.
        </p>
        <ul className="mt-3 space-y-2">
          {failedSyncItems.length === 0 ? (
            <li className="text-sm text-gray-500">No failed sync items.</li>
          ) : (
            failedSyncItems.map((row) => (
              <li key={row.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                <p className="font-medium text-gray-900">
                  {row.operation} • {row.entity_type}:{row.entity_id}
                </p>
                <p className="text-gray-600">
                  Attempts: {row.attempts} • Next retry: <Timestamp iso={row.next_retry_at} />
                </p>
                {row.last_error ? <p className="text-red-700">{row.last_error}</p> : null}
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const reason = String(formData.get("reason") ?? "");
                    await retryCircleSyncItemAction(row.id, reason);
                  }}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={8}
                    placeholder="Reason for retry"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-gray-600">
                    <input type="checkbox" required />
                    Idempotency acknowledged
                  </label>
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Retry
                  </button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const reason = String(formData.get("reason") ?? "");
                    await resolveCircleSyncItemAction(row.id, reason);
                  }}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={8}
                    placeholder="Resolution note"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                  >
                    Resolve
                  </button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const reason = String(formData.get("reason") ?? "");
                    await skipCircleSyncItemAction(row.id, reason);
                  }}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={8}
                    placeholder="Skip reason"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Skip
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">QuickBooks Queue Monitor</h2>
        <p className="mt-1 text-sm text-gray-600">
          QB export failures and inbound payments awaiting reconciliation.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Export Pending / Retrying</p>
            <p className="mt-1 text-gray-700">{qboExportPendingCount}</p>
          </article>
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Export Failed</p>
            <p className={`mt-1 font-medium ${qboExportFailedRows.length > 0 ? "text-red-600" : "text-gray-700"}`}>{qboExportFailedRows.length}</p>
          </article>
          <article className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="font-medium text-gray-900">Recon Pending Review</p>
            <p className={`mt-1 font-medium ${qbReconPendingRows.length > 0 ? "text-amber-600" : "text-gray-700"}`}>{qbReconPendingRows.length}</p>
          </article>
        </div>

        {qboExportFailedRows.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-gray-900 mb-2">Failed Exports</p>
            <ul className="space-y-2">
              {qboExportFailedRows.map((row) => (
                <li key={row.id} className="rounded-lg border border-red-100 bg-red-50 p-2 text-sm">
                  <p className="font-medium text-gray-900">Invoice: {row.invoice_id}</p>
                  <p className="text-gray-600 text-xs mt-0.5">
                    Retries: {row.retry_count} • Queued: <Timestamp iso={row.created_at} />
                  </p>
                  {row.error_message && (
                    <p className="text-red-700 text-xs mt-0.5 font-mono">{row.error_message}</p>
                  )}
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const reason = String(formData.get("reason") ?? "");
                      await retryQBExportAction(row.id, reason);
                    }}
                    className="mt-2 flex items-end gap-2"
                  >
                    <label className="flex-1 text-xs text-gray-600">
                      Reason
                      <input
                        name="reason"
                        type="text"
                        required
                        minLength={8}
                        placeholder="Why retrying?"
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                    >
                      Retry
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <p className="text-sm font-medium text-gray-900 mb-2">Inbound Payments — Pending Review</p>
          <ul className="space-y-2">
            {qbReconPendingRows.length === 0 ? (
              <li className="text-sm text-gray-500">No inbound QB payments awaiting review.</li>
            ) : (
              qbReconPendingRows.map((row) => (
                <li key={row.id} className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-sm">
                  <p className="font-medium text-gray-900">QB Payment: {row.qbo_payment_id}</p>
                  <p className="text-gray-600 text-xs mt-0.5">
                    {(row.amount_cents / 100).toFixed(2)} {row.currency.toUpperCase()} • Paid: <Timestamp iso={row.paid_at} /> • Received: <Timestamp iso={row.created_at} />
                  </p>
                  {row.notes && (
                    <p className="text-amber-700 text-xs mt-0.5">{row.notes}</p>
                  )}
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const reason = String(formData.get("reason") ?? "");
                      await ignoreQBReconciliationItemAction(row.id, reason);
                    }}
                    className="mt-2 flex items-end gap-2"
                  >
                    <label className="flex-1 text-xs text-gray-600">
                      Reason
                      <input
                        name="reason"
                        type="text"
                        required
                        minLength={8}
                        placeholder="Why ignoring?"
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                    >
                      Ignore
                    </button>
                  </form>
                </li>
              ))
            )}
          </ul>
        </div>

        {settlementAtRisk.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-gray-900 mb-2">Settlement At Risk (≤3 days)</p>
            <ul className="space-y-2">
              {settlementAtRisk.map((row) => (
                <li key={row.id} className="rounded-lg border border-red-100 p-2 text-sm">
                  <p className="font-medium text-gray-900">{row.organization?.name ?? row.organization_id}</p>
                  <p className="text-gray-600 text-xs mt-0.5">
                    {row.status} • Due <Timestamp iso={row.due_date} /> • {((row.total_cents ?? 0) / 100).toFixed(2)}
                  </p>
                  {row.organization?.slug ? (
                    <Link
                      href={`/org/${row.organization.slug}`}
                      className="mt-2 inline-block rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open Org
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">
          Recent Operation Outcomes
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Explicit success/failure outcomes for manual ops actions.
        </p>
        <ul className="mt-3 space-y-2">
          {operationOutcomes.length === 0 ? (
            <li className="text-sm text-gray-500">No recent operation outcomes.</li>
          ) : (
            operationOutcomes.map((outcome) => (
              <li
                key={outcome.id}
                className="rounded-lg border border-gray-100 p-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{outcome.action}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      outcome.success === true
                        ? "bg-emerald-50 text-emerald-700"
                        : outcome.success === false
                          ? "bg-red-50 text-red-700"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {outcome.success === true
                      ? "success"
                      : outcome.success === false
                        ? "failed"
                        : "recorded"}
                  </span>
                  <span className="text-xs text-gray-500">
                    <Timestamp iso={outcome.createdAt} />
                  </span>
                </div>
                <p className="mt-1 text-gray-700">{outcome.message}</p>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Application Review</h2>
            <a
              href="/admin/applications"
              className="text-sm font-medium text-[#D92327] hover:underline"
            >
              Open Applications
            </a>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Pending queue: {pendingApplications.length}
          </p>

          <ul className="mt-3 space-y-2">
            {pendingApplications.length === 0 ? (
              <li className="text-sm text-gray-500">No pending applications.</li>
            ) : (
              pendingApplications.map((row) => (
                <li key={row.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                  <p className="font-medium text-gray-900">
                    {row.applicant_name ?? "Unnamed applicant"}
                  </p>
                  <p className="text-gray-600">
                    {row.application_type} • {row.status} • <Timestamp iso={row.created_at} />
                  </p>
                  {row.status === "pending_review" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <form
                        action={async () => {
                          "use server";
                          await approveApplication(row.id);
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        >
                          Approve
                        </button>
                      </form>
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const reason = String(formData.get("reason") ?? "");
                          await rejectApplication(row.id, reason);
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          name="reason"
                          required
                          minLength={8}
                          placeholder="Rejection reason"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : null}
                  {row.status === "approved" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">
                        Awaiting payment/onboarding
                      </span>
                      <form
                        action={async () => {
                          "use server";
                          await resendApplicationInvite(row.id);
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          Resend Invite &amp; Payment Link
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Payment Failures</h2>
          <p className="mt-1 text-sm text-gray-600">
            Failed/overdue/pending-settlement invoices requiring triage.
          </p>

          <ul className="mt-3 space-y-2">
            {paymentFailures.length === 0 ? (
              <li className="text-sm text-gray-500">No payment failures in the current query window.</li>
            ) : (
              paymentFailures.slice(0, 8).map((row) => (
                <li key={row.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                  <p className="font-medium text-gray-900">
                    {row.organization?.name ?? row.organization_id}
                  </p>
                  <p className="text-gray-600">
                    {row.status} • ${(row.total_cents / 100).toFixed(2)} • Due <Timestamp iso={row.due_date} />
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.organization?.slug ? (
                      <Link
                        href={`/org/${row.organization.slug}`}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Open Org
                      </Link>
                    ) : null}
                    {row.organization?.email ? (
                      <a
                        href={`mailto:${row.organization.email}`}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Contact Org Admin
                      </a>
                    ) : null}
                  </div>
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const reason = String(formData.get("reason") ?? "");
                      await retryInvoiceChargeAction(row.id, reason);
                    }}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      name="reason"
                      required
                      minLength={8}
                      placeholder="Reason for retry charge"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Retry Charge
                    </button>
                  </form>
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const reason = String(formData.get("reason") ?? "");
                      await voidInvoiceAction(row.id, reason);
                    }}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      name="reason"
                      required
                      minLength={8}
                      placeholder="Reason for void"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Void Invoice
                    </button>
                  </form>
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Admin Transfers</h2>
          <p className="mt-1 text-sm text-gray-600">
            Pending: {transferPendingCount} &bull; Recent total: {adminTransfers.length}
          </p>

          <ul className="mt-3 space-y-2">
            {adminTransfers.length === 0 ? (
              <li className="text-sm text-gray-500">No recent admin transfer requests.</li>
            ) : (
              adminTransfers.map((row) => (
                <li key={row.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                  <p className="text-gray-600">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      row.status === "pending"
                        ? "bg-amber-50 text-amber-700"
                        : row.status === "fallback_triggered"
                        ? "bg-red-50 text-red-700"
                        : "bg-green-50 text-green-700"
                    }`}>
                      {row.status}
                    </span>
                    {" "}&bull; Requested <Timestamp iso={row.requested_at} />
                    {row.status === "pending" && <>{" "}&bull; Timeout <Timestamp iso={row.timeout_at} /></>}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Org: {row.organization_id.slice(0, 8)}&hellip;
                    {row.to_user_id ? ` \u2192 ${row.to_user_id.slice(0, 8)}\u2026` : " (no successor)"}
                    {row.reason ? ` — ${row.reason}` : ""}
                  </p>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            Legal / Retention Compliance
          </h2>
          <Link
            href={
              latestConference
                ? `/admin/conference/${latestConference.id}/legal`
                : "/admin/conference"
            }
            className="text-sm font-medium text-[#D92327] hover:underline"
          >
            Open Conference Legal Manager
          </Link>
        </div>
        {!latestConference ? (
          <p className="mt-2 text-sm text-gray-600">
            No conference instance found, so legal/retention coverage cannot be computed.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-gray-100 p-3 text-sm">
              <p className="font-medium text-gray-900">
                {latestConference.name} ({latestConference.year}-{latestConference.edition_code})
              </p>
              <p className="text-gray-600">
                Status: {latestConference.status} • Dates:{" "}
                <Timestamp iso={latestConference.start_date} /> -{" "}
                <Timestamp iso={latestConference.end_date} />
              </p>
              <p className="text-gray-600">
                Required users: {requiredUserCount} • Overall legal coverage:{" "}
                {overallLegalCoveragePct.toFixed(1)}%
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Document
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Version
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Effective
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Acceptance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {legalCoverageRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={4}>
                        No active legal versions found for this conference.
                      </td>
                    </tr>
                  ) : (
                    legalCoverageRows.map((row) => (
                      <tr key={`${row.documentType}:${row.version}`}>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {row.documentType}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.version}</td>
                        <td className="px-3 py-2 text-gray-700">
                          <Timestamp iso={row.effectiveAt} />
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {row.acceptedUsers}/{requiredUserCount} (
                          {row.coveragePct.toFixed(1)}%)
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-gray-100 p-3 text-sm">
              <p className="font-medium text-gray-900">Retention Status</p>
              {retentionPolicyValues.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-gray-700">
                  {retentionPolicyValues.map((row) => (
                    <li key={row.key}>
                      {row.key}:{" "}
                      {typeof row.value_json === "string"
                        ? row.value_json
                        : JSON.stringify(row.value_json)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-gray-600">
                  Retention policy keys are not currently configured in active policy values.
                </p>
              )}
              <p className="mt-2 text-gray-700">
                Latest retention run:{" "}
                {latestRetentionRun
                  ? <><Timestamp iso={latestRetentionRun.executed_at} /> ({latestRetentionRun.status}, {latestRetentionRun.records_purged} purged)</>
                  : "none recorded"}
                .
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Audit Log Viewer</h2>
          <a
            href={`/api/admin/ops/audit-export?action=${encodeURIComponent(
              auditActionFilter
            )}&actor=${encodeURIComponent(auditActorFilter)}&entityType=${encodeURIComponent(
              auditEntityTypeFilter
            )}&entityId=${encodeURIComponent(
              auditEntityIdFilter
            )}&from=${encodeURIComponent(auditFromFilter)}&to=${encodeURIComponent(
              auditToFilter
            )}&limit=5000`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Search recent audit events by action and actor id.
        </p>

        <form method="get" className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-sm text-gray-700">
            Action
            <input
              type="text"
              name="auditAction"
              defaultValue={auditActionFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="policy_publish"
            />
          </label>
          <label className="text-sm text-gray-700">
            Actor Id
            <input
              type="text"
              name="auditActor"
              defaultValue={auditActorFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="uuid fragment"
            />
          </label>
          <label className="text-sm text-gray-700">
            Entity Type
            <input
              type="text"
              name="auditEntityType"
              defaultValue={auditEntityTypeFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="ops_alert"
            />
          </label>
          <label className="text-sm text-gray-700">
            Entity Id
            <input
              type="text"
              name="auditEntityId"
              defaultValue={auditEntityIdFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="uuid fragment"
            />
          </label>
          <label className="text-sm text-gray-700">
            From
            <input
              type="datetime-local"
              name="auditFrom"
              defaultValue={auditFromFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-gray-700">
            To
            <input
              type="datetime-local"
              name="auditTo"
              defaultValue={auditToFilter}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Apply
            </button>
            <a
              href="/admin/ops"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </a>
          </div>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Timestamp</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Action</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Entity</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedAuditLogs.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-gray-700"><Timestamp iso={row.created_at} /></td>
                  <td className="px-3 py-2 font-medium text-gray-900">{row.action}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.entity_type ?? "-"}
                    {row.entity_id ? ` (${row.entity_id})` : ""}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.actor_type}
                    {row.actor_id ? `:${row.actor_id}` : ""}
                  </td>
                </tr>
              ))}
              {pagedAuditLogs.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={4}>
                    No audit rows found for the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
          <span>
            Showing {pagedAuditLogs.length} of {auditLogs.length} rows (page {normalizedAuditPage} of {auditTotalPages})
          </span>
          <div className="flex items-center gap-2">
            {normalizedAuditPage > 1 ? (
              <a
                href={`/admin/ops?${(() => {
                  const p = new URLSearchParams(baseAuditParams);
                  p.set("auditPage", String(normalizedAuditPage - 1));
                  return p.toString();
                })()}`}
                className="rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-50"
              >
                Prev
              </a>
            ) : (
              <span className="rounded-md border border-gray-200 px-2 py-1 text-gray-400">Prev</span>
            )}
            {normalizedAuditPage < auditTotalPages ? (
              <a
                href={`/admin/ops?${(() => {
                  const p = new URLSearchParams(baseAuditParams);
                  p.set("auditPage", String(normalizedAuditPage + 1));
                  return p.toString();
                })()}`}
                className="rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-50"
              >
                Next
              </a>
            ) : (
              <span className="rounded-md border border-gray-200 px-2 py-1 text-gray-400">Next</span>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
