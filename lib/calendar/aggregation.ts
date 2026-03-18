// ─────────────────────────────────────────────────────────────────
// Chunk 23: Calendar aggregation service.
//
// Queries all source systems, builds projected CalendarItem rows,
// upserts into calendar_items, then fetches the full enriched view.
//
// Source systems (12 total):
//   conference_instances, policy_sets, message_campaigns,
//   renewal_job_runs, scheduler_runs, retention_jobs, ops_alerts,
//   benchmarking_surveys, billing_runs, conference_legal_versions,
//   conference_program_items, signup_applications
//
// ALWAYS called from a server context (API route or server page).
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type {
  CalendarItem,
  CalendarItemEnriched,
  CalendarAggregationResult,
  DaySaturation,
  CalendarLayer,
  CalendarCategory,
  CalendarSeverity,
  CalendarStatus,
} from "./types";

const SATURATION_THRESHOLD = 5;

// ── Severity computation ───────────────────────────────────────────

function computeSeverity(startsAt: Date, now: Date, status: CalendarStatus): CalendarSeverity {
  if (status === "blocked") return "critical";
  const hours = (startsAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hours <= 0)       return "critical"; // past / missed
  if (hours <= 48)      return "critical";
  if (hours <= 7 * 24)  return "warning";
  return "normal";
}

// ── Helpers ────────────────────────────────────────────────────────

function sk(entityType: string, entityId: string, event: string): string {
  return `${entityType}:${entityId}:${event}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Projected row type ─────────────────────────────────────────────

type ProjectedRow = Omit<CalendarItem, "id" | "owner_id" | "created_at" | "updated_at" | "confirmed_at" | "confirmed_by"> & {
  source_mode: "projected";
};

function makeProjected(
  title: string,
  description: string | null,
  category: CalendarCategory,
  layer: CalendarLayer,
  startsAt: Date,
  endsAt: Date | null,
  entityType: string,
  entityId: string,
  event: string,
  now: Date,
  extraMeta: Record<string, unknown> = {},
  requiresConfirmation = false
): ProjectedRow {
  const status: CalendarStatus = startsAt < now ? "done" : "planned";
  return {
    title,
    description,
    category,
    layer,
    starts_at:            startsAt.toISOString(),
    ends_at:              endsAt?.toISOString() ?? null,
    source_mode:          "projected",
    source_key:           sk(entityType, entityId, event),
    related_entity_type:  entityType as CalendarItem["related_entity_type"],
    related_entity_id:    entityId,
    status,
    severity:             computeSeverity(startsAt, now, status),
    metadata:             { event, ...extraMeta },
    requires_confirmation: requiresConfirmation,
  };
}

// ── Main aggregation ───────────────────────────────────────────────

export async function syncAndFetchCalendar(
  windowStartIso?: string,
  windowEndIso?: string
): Promise<CalendarAggregationResult> {
  const supabase = createAdminClient();
  const now = new Date();

  const windowStart = windowStartIso
    ? new Date(windowStartIso)
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const windowEnd = windowEndIso
    ? new Date(windowEndIso)
    : new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

  const projected: ProjectedRow[] = [];

  // ── 1. Conference instances ──────────────────────────────────────
  const { data: conferences } = await supabase
    .from("conference_instances")
    .select("id, name, year, status, start_date, end_date, registration_open_at, registration_close_at, on_sale_at, board_decision_at")
    .order("start_date", { ascending: false });

  for (const c of conferences ?? []) {
    const meta = { conference_name: c.name, conference_year: c.year, conference_status: c.status };
    if (c.registration_open_at) projected.push(makeProjected(`${c.name}: Registration Opens`, "Conference registration opens to delegates and exhibitors.", "conference", "people", new Date(c.registration_open_at), null, "conference_instance", c.id, "registration_open", now, meta));
    if (c.registration_close_at) projected.push(makeProjected(`${c.name}: Registration Closes`, "Deadline for conference registrations.", "conference", "people", new Date(c.registration_close_at), null, "conference_instance", c.id, "registration_close", now, meta));
    if (c.on_sale_at) projected.push(makeProjected(`${c.name}: On Sale`, "Conference tickets go on sale.", "conference", "people", new Date(c.on_sale_at), null, "conference_instance", c.id, "on_sale", now, meta));
    if (c.board_decision_at) projected.push(makeProjected(`${c.name}: Board Decision`, "Scheduled board decision checkpoint.", "conference", "admin_ops", new Date(c.board_decision_at), null, "conference_instance", c.id, "board_decision", now, meta));
    if (c.start_date) {
      projected.push(makeProjected(
        `${c.name}: Conference`,
        `Conference runs in ${c.year}.`,
        "conference", "people",
        new Date(c.start_date + "T09:00:00-05:00"),
        c.end_date ? new Date(c.end_date + "T18:00:00-05:00") : null,
        "conference_instance", c.id, "event_window", now, meta
      ));
    }
  }

  // ── 2. Policy sets ───────────────────────────────────────────────
  const { data: policySets } = await supabase
    .from("policy_sets")
    .select("id, name, status, effective_at, published_at")
    .not("effective_at", "is", null);

  for (const ps of policySets ?? []) {
    const meta = { policy_name: ps.name, policy_status: ps.status };
    if (ps.effective_at) projected.push(makeProjected(`Policy: ${ps.name} Effective`, "Policy set becomes the active operational baseline.", "renewals_billing", "admin_ops", new Date(ps.effective_at), null, "policy_set", ps.id, "effective", now, meta));
    if (ps.published_at) projected.push(makeProjected(`Policy: ${ps.name} Published`, "Policy set published and visible to staff.", "renewals_billing", "admin_ops", new Date(ps.published_at), null, "policy_set", ps.id, "published", now, meta));
  }

  // ── 3. Message campaigns ─────────────────────────────────────────
  const { data: campaigns } = await supabase
    .from("message_campaigns")
    .select("id, name, status, trigger_source, scheduled_at, sent_at, completed_at")
    .not("scheduled_at", "is", null);

  for (const c of campaigns ?? []) {
    const ts = c.scheduled_at ?? c.sent_at ?? c.completed_at;
    if (!ts) continue;
    projected.push(makeProjected(`Comms: ${c.name}`, `${c.trigger_source} campaign — status: ${c.status}.`, "communications", "admin_ops", new Date(ts), null, "message_campaign", c.id, "send", now, { campaign_status: c.status, trigger_source: c.trigger_source }));
  }

  // ── 4. Renewal job runs ──────────────────────────────────────────
  // TODO (v1.4): Add predictive future-run projection here.
  //   When the renewal scheduler gains a concept of "next scheduled run date",
  //   project a FUTURE calendar item for that date with requires_confirmation=true.
  //   CRITICAL: future projections MUST use the upcoming run's UUID as the source key,
  //   not a stable period key like "renewal_charge:2026-Q2". A stable key would let
  //   a past cycle's confirmation carry forward — exactly what the deadhand prevents.
  //   See: lib/calendar/confirmation.ts for the cycle-boundary safety note.
  const { data: renewalRuns } = await supabase
    .from("renewal_job_runs")
    .select("id, job_type, status, started_at, completed_at, orgs_failed")
    .order("started_at", { ascending: false })
    .limit(50);

  for (const run of renewalRuns ?? []) {
    if (!run.started_at) continue;
    const failed = (run.orgs_failed ?? 0) > 0;
    const isFinancial = run.job_type === "charge_run" || run.job_type === "grace_run";
    const label = run.job_type === "reminder_run" ? "Renewal Reminders" : run.job_type === "charge_run" ? "Renewal Charges" : "Grace Check";
    projected.push(makeProjected(
      `Renewals: ${label}${failed ? " (failures)" : ""}`,
      `Job run — status: ${run.status}${failed ? ` (${run.orgs_failed} orgs failed)` : ""}.`,
      "renewals_billing", "system_ops",
      new Date(run.started_at),
      run.completed_at ? new Date(run.completed_at) : null,
      "renewal_job_run", run.id, "run", now,
      { job_type: run.job_type, run_status: run.status, orgs_failed: run.orgs_failed },
      isFinancial, // requires_confirmation for charge/grace runs
    ));
  }

  // ── 5. Scheduler runs ────────────────────────────────────────────
  const { data: schedulerRuns } = await supabase
    .from("scheduler_runs")
    .select("id, conference_id, status, run_mode, started_at, completed_at")
    .order("started_at", { ascending: false })
    .limit(30);

  for (const run of schedulerRuns ?? []) {
    if (!run.started_at) continue;
    projected.push(makeProjected(`Scheduler: ${run.run_mode} run`, `Conference scheduler — status: ${run.status}.`, "conference", "system_ops", new Date(run.started_at), run.completed_at ? new Date(run.completed_at) : null, "scheduler_run", run.id, "run", now, { run_status: run.status, run_mode: run.run_mode }));
  }

  // ── 6. Retention jobs ────────────────────────────────────────────
  const { data: retentionJobs } = await supabase
    .from("retention_jobs")
    .select("id, job_type, status, executed_at, records_purged")
    .order("executed_at", { ascending: false })
    .limit(20);

  for (const job of retentionJobs ?? []) {
    if (!job.executed_at) continue;
    projected.push(makeProjected(`Retention: ${titleCase(job.job_type)}`, `Data retention purge — ${job.records_purged ?? 0} records purged.`, "legal_retention", "system_ops", new Date(job.executed_at), null, "retention_job", job.id, "run", now, { job_type: job.job_type, run_status: job.status, records_purged: job.records_purged }));
  }

  // ── 7. Ops alerts with due dates ─────────────────────────────────
  const { data: opsAlerts } = await supabase
    .from("ops_alerts")
    .select("id, rule_key, severity, status, message, due_at")
    .not("due_at", "is", null)
    .in("status", ["open", "acknowledged"]);

  for (const alert of opsAlerts ?? []) {
    if (!alert.due_at) continue;
    const sev: CalendarSeverity = alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "warning" : "normal";
    projected.push({ title: `Alert: ${alert.rule_key}`, description: alert.message, category: "integrations_ops", layer: "system_ops", starts_at: alert.due_at, ends_at: null, source_mode: "projected", source_key: sk("ops_alert", alert.id, "due"), related_entity_type: "ops_alert", related_entity_id: alert.id, status: "planned", severity: sev, metadata: { rule_key: alert.rule_key, alert_status: alert.status }, requires_confirmation: false });
  }

  // ── 8. Benchmarking surveys ──────────────────────────────────────
  const { data: surveys } = await supabase
    .from("benchmarking_surveys")
    .select("id, title, fiscal_year, status, opens_at, closes_at");

  for (const s of surveys ?? []) {
    const label = s.title ?? `FY${s.fiscal_year} Survey`;
    const meta  = { survey_title: s.title, fiscal_year: s.fiscal_year, survey_status: s.status };
    if (s.opens_at)  projected.push(makeProjected(`Benchmarking: ${label} Opens`,  "Benchmarking survey opens for member organization submissions.", "membership", "people", new Date(s.opens_at),  null, "benchmarking_survey", s.id, "opens",  now, meta));
    if (s.closes_at) projected.push(makeProjected(`Benchmarking: ${label} Closes`, "Deadline for benchmarking survey submissions.", "membership", "people", new Date(s.closes_at), null, "benchmarking_survey", s.id, "closes", now, meta));
  }

  // ── 9. Billing runs ──────────────────────────────────────────────
  // TODO (v1.4): Same predictive projection note as renewal_job_runs above.
  //   When billing_runs gains a "scheduled_for" concept, project the next
  //   upcoming run so admins can confirm it before it fires.
  //   Same UUID-as-source-key requirement applies — no stable period keys.
  const { data: billingRuns } = await supabase
    .from("billing_runs")
    .select("id, conference_id, status, started_at, completed_at, failed_items")
    .order("started_at", { ascending: false })
    .limit(30);

  for (const run of billingRuns ?? []) {
    if (!run.started_at) continue;
    const failed = (run.failed_items ?? 0) > 0;
    projected.push(makeProjected(
      `Billing Run${failed ? " (failures)" : ""}`,
      `Conference billing run — status: ${run.status}${failed ? `, ${run.failed_items} failures` : ""}.`,
      "integrations_ops", "system_ops",
      new Date(run.started_at),
      run.completed_at ? new Date(run.completed_at) : null,
      "billing_run", run.id, "run", now,
      { run_status: run.status, failed_items: run.failed_items, conference_id: run.conference_id },
      true, // always requires_confirmation — money
    ));
  }

  // ── 10. Conference legal versions ────────────────────────────────
  const { data: legalVersions } = await supabase
    .from("conference_legal_versions")
    .select("id, conference_id, document_type, version, effective_at, conference:conference_instances!inner(name, year)")
    .not("effective_at", "is", null);

  for (const lv of legalVersions ?? []) {
    if (!lv.effective_at) continue;
    const conf = lv.conference as { name: string; year: number } | null;
    const doc  = titleCase(lv.document_type);
    projected.push(makeProjected(`Legal: ${conf?.name ?? "Conference"} — ${doc} v${lv.version}`, `${doc} v${lv.version} becomes effective for ${conf?.name ?? "this conference"}.`, "legal_retention", "admin_ops", new Date(lv.effective_at), null, "conference_legal_version", lv.id, "effective", now, { document_type: lv.document_type, version: lv.version, conference_id: lv.conference_id, conference_name: conf?.name }));
  }

  // ── 11. Conference program items (required only) ─────────────────
  const { data: programItems } = await supabase
    .from("conference_program_items")
    .select("id, conference_id, title, item_type, starts_at, ends_at, conference:conference_instances!inner(name, year)")
    .eq("is_required", true);

  for (const item of programItems ?? []) {
    const conf = item.conference as { name: string; year: number } | null;
    projected.push(makeProjected(`${conf?.name ?? "Conference"}: ${item.title}`, `Required program item — ${titleCase(item.item_type)}.`, "conference", "people", new Date(item.starts_at), new Date(item.ends_at), "conference_program_item", item.id, "event", now, { item_type: item.item_type, conference_id: item.conference_id, conference_name: conf?.name }));
  }

  // ── 12. Signup applications (pending review) ─────────────────────
  const { data: applications } = await supabase
    .from("signup_applications")
    .select("id, application_type, status, created_at")
    .is("reviewed_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  for (const app of applications ?? []) {
    if (!app.created_at) continue;
    const ageDays = (now.getTime() - new Date(app.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const sev: CalendarSeverity = ageDays > 14 ? "critical" : ageDays > 7 ? "warning" : "normal";
    projected.push({ title: `Application: ${titleCase(app.application_type ?? "unknown")} pending review`, description: `${titleCase(app.application_type ?? "unknown")} application submitted — awaiting admin review.`, category: "membership", layer: "admin_ops", starts_at: app.created_at, ends_at: null, source_mode: "projected", source_key: sk("signup_application", app.id, "submitted"), related_entity_type: "signup_application", related_entity_id: app.id, status: "active", severity: sev, metadata: { application_type: app.application_type, app_status: app.status }, requires_confirmation: false });
  }

  // ── 13. Events ───────────────────────────────────────────────────
  const { data: eventsData } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, status, audience_mode, location")
    .in("status", ["published", "completed"]);

  for (const ev of eventsData ?? []) {
    if (!ev.starts_at) continue;
    projected.push(makeProjected(
      ev.title,
      ev.audience_mode === "public" ? "Public Event" : "Members-Only Event",
      "events",
      "people",
      new Date(ev.starts_at),
      ev.ends_at ? new Date(ev.ends_at) : null,
      "event",
      ev.id,
      "event_window",
      now,
      { location: ev.location }
    ));
  }

  // ── Upsert projected rows (batched) ──────────────────────────────
  // confirmed_at / confirmed_by are intentionally excluded from the upsert
  // so existing admin confirmations are never overwritten by a sync.
  if (projected.length > 0) {
    const rows = projected.map((p) => ({
      title: p.title, description: p.description, category: p.category, layer: p.layer,
      starts_at: p.starts_at, ends_at: p.ends_at, source_mode: "projected" as const,
      source_key: p.source_key, related_entity_type: p.related_entity_type,
      related_entity_id: p.related_entity_id, status: p.status, severity: p.severity,
      metadata: p.metadata as Json,
      requires_confirmation: p.requires_confirmation,
    }));
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await supabase.from("calendar_items").upsert(rows.slice(i, i + CHUNK), { onConflict: "source_key", ignoreDuplicates: false });
    }
  }

  // ── Deadhand severity correction ─────────────────────────────────
  // After upsert, fix severity/status for requires_confirmation items:
  //   confirmed → always normal/planned (de-escalate)
  //   unconfirmed → escalate based on time-to-fire:
  //     ≤24h  → blocked + critical   (job will abort)
  //     ≤3d   → critical             (urgent, call to action)
  //     ≤7d   → warning              (heads up)
  await supabase.from("calendar_items")
    .update({ severity: "normal", status: "planned" })
    .eq("requires_confirmation", true)
    .not("confirmed_at", "is", null)
    .eq("source_mode", "projected")
    .neq("status", "done");
  // Escalate unconfirmed items by time window (three passes, most urgent wins)
  const h = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000).toISOString();
  await supabase.from("calendar_items").update({ severity: "warning",  status: "planned"  }).eq("requires_confirmation", true).is("confirmed_at", null).eq("source_mode", "projected").neq("status", "done").gte("starts_at", h(0)).lte("starts_at", h(7 * 24));
  await supabase.from("calendar_items").update({ severity: "critical", status: "planned"  }).eq("requires_confirmation", true).is("confirmed_at", null).eq("source_mode", "projected").neq("status", "done").gte("starts_at", h(0)).lte("starts_at", h(3 * 24));
  await supabase.from("calendar_items").update({ severity: "critical", status: "blocked"  }).eq("requires_confirmation", true).is("confirmed_at", null).eq("source_mode", "projected").neq("status", "done").gte("starts_at", h(0)).lte("starts_at", h(24));

  // ── Fetch enriched items for the window ─────────────────────────
  const { data: rawItems } = await supabase
    .from("calendar_items")
    .select("*, owner:profiles!owner_id(id, display_name)")
    .gte("starts_at", windowStart.toISOString())
    .lte("starts_at", windowEnd.toISOString())
    .order("starts_at", { ascending: true });

  // Notes counts
  const itemIds = (rawItems ?? []).map((r) => r.id);
  const notesCounts: Record<string, number> = {};
  if (itemIds.length > 0) {
    const { data: noteRows } = await supabase.from("calendar_item_notes").select("calendar_item_id").in("calendar_item_id", itemIds);
    for (const n of noteRows ?? []) notesCounts[n.calendar_item_id] = (notesCounts[n.calendar_item_id] ?? 0) + 1;
  }

  const items: CalendarItemEnriched[] = (rawItems ?? []).map((r) => {
    const owner = r.owner as { id: string; display_name: string | null } | null;
    return {
      id: r.id, title: r.title, description: r.description ?? null,
      category:     r.category     as CalendarItem["category"],
      layer:        r.layer        as CalendarItem["layer"],
      starts_at:    r.starts_at,
      ends_at:      r.ends_at ?? null,
      source_mode:  r.source_mode  as CalendarItem["source_mode"],
      source_key:   r.source_key ?? null,
      related_entity_type: (r.related_entity_type ?? null) as CalendarItem["related_entity_type"],
      related_entity_id:   r.related_entity_id ?? null,
      owner_id:     r.owner_id ?? null,
      status:       r.status       as CalendarItem["status"],
      severity:     r.severity     as CalendarItem["severity"],
      metadata:     (r.metadata as Record<string, unknown>) ?? {},
      created_at:   r.created_at,
      updated_at:   r.updated_at,
      requires_confirmation: r.requires_confirmation ?? false,
      confirmed_at:  r.confirmed_at ?? null,
      confirmed_by:  r.confirmed_by ?? null,
      owner_name:   owner?.display_name ?? null,
      notes_count:  notesCounts[r.id] ?? 0,
    };
  });

  // Saturation
  const satMap = new Map<string, DaySaturation>();
  for (const item of items) {
    const date = item.starts_at.slice(0, 10);
    let ds = satMap.get(date);
    if (!ds) { ds = { date, admin_ops_count: 0, system_ops_count: 0, people_count: 0, overloaded: false }; satMap.set(date, ds); }
    if (item.layer === "admin_ops") ds.admin_ops_count++;
    else if (item.layer === "system_ops") ds.system_ops_count++;
    else ds.people_count++;
  }
  const saturation: DaySaturation[] = [];
  for (const ds of satMap.values()) {
    ds.overloaded = ds.admin_ops_count + ds.system_ops_count + ds.people_count >= SATURATION_THRESHOLD;
    saturation.push(ds);
  }
  saturation.sort((a, b) => a.date.localeCompare(b.date));

  return { items, saturation, synced_at: now.toISOString() };
}

// ── Calendar watermark ─────────────────────────────────────────────
// max(updated_at) across calendar_items. null when table is empty.

export async function getCalendarWatermark(): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("calendar_items")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.updated_at ?? null;
}

// ── Source watermark ───────────────────────────────────────────────
// Returns max "last activity" timestamp across all 12 source tables.
// The heartbeat uses this to decide whether to run a sync.

export async function getSourceWatermark(): Promise<string | null> {
  const supabase = createAdminClient();

  const [
    conf, policy, comms, renewals, scheduler,
    retention, alerts, surveys, billing, legalV,
    progItems, apps,
  ] = await Promise.all([
    supabase.from("conference_instances")     .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("policy_sets")             .select("created_at").order("created_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("message_campaigns")       .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("renewal_job_runs")        .select("started_at").order("started_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("scheduler_runs")          .select("started_at").order("started_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("retention_jobs")          .select("executed_at").order("executed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ops_alerts")              .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("benchmarking_surveys")    .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("billing_runs")            .select("started_at").order("started_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("conference_legal_versions").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("conference_program_items") .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
    supabase.from("signup_applications")     .select("updated_at").order("updated_at",  { ascending: false }).limit(1).maybeSingle(),
  ]);

  const timestamps = [
    conf.data?.updated_at, policy.data?.created_at, comms.data?.updated_at,
    renewals.data?.started_at, scheduler.data?.started_at, retention.data?.executed_at,
    alerts.data?.updated_at, surveys.data?.updated_at, billing.data?.started_at,
    legalV.data?.created_at, progItems.data?.updated_at, apps.data?.updated_at,
  ].filter((t): t is string => !!t);

  return timestamps.length === 0 ? null : timestamps.reduce((max, t) => (t > max ? t : max));
}
