"use server";

import { requireAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { resolveBadgeRun } from "@/lib/conference/badges/run";
import {
  normalizeBadgeTemplateConfig,
  resolveBadgeVariant,
  type BadgeTextBindingKey,
  type BadgeFrontConfig,
} from "@/lib/conference/badges/template";
import { compactWhitespace, fitTextLayout } from "@/lib/conference/badges/text-fit";

export type BadgeReprintReason = "damaged" | "lost" | "name_change" | "ops_override";
export type BadgeJobStatus =
  | "queued"
  | "rendering"
  | "rendered"
  | "pdf_generated"
  | "sent_to_printer"
  | "printed"
  | "failed"
  | "canceled"
  | "delivered";

export type DelegateBatchOrderMode = "delegate_first_name" | "delegate_last_name";
export type ExhibitorBatchOrderMode = "exhibitor_room_number" | "exhibitor_org_name";

export type BadgeSetupSessionState = {
  startFrom?: "blank" | "current";
  canvasPreset?: "oversized" | "trimmed";
  delegateOverlay?: string;
  exhibitorOverlay?: string;
  qrMode?: "person_uuid" | "profile_link";
  frontTheme?: "map_tint" | "solid_tint";
  reprintPipeline?: "pdf" | "printer_bridge";
};

const BADGE_REPRINT_REASONS: BadgeReprintReason[] = [
  "damaged",
  "lost",
  "name_change",
  "ops_override",
];

function isBadgeReprintReason(value: string): value is BadgeReprintReason {
  return BADGE_REPRINT_REASONS.includes(value as BadgeReprintReason);
}

function validateBadgeJobTransition(from: BadgeJobStatus, to: BadgeJobStatus): boolean {
  const allowed: Record<BadgeJobStatus, BadgeJobStatus[]> = {
    queued: ["rendering", "rendered", "failed", "canceled"],
    rendering: ["rendered", "failed", "canceled"],
    rendered: ["pdf_generated", "sent_to_printer", "failed", "canceled"],
    pdf_generated: ["delivered", "failed"],
    sent_to_printer: ["printed", "failed", "canceled"],
    printed: ["delivered"],
    failed: [],
    canceled: [],
    delivered: [],
  };
  return allowed[from].includes(to);
}

type BadgePreflightIssue = {
  code:
    | "MISSING_CANONICAL_PERSON"
    | "MISSING_TEMPLATE"
    | "ROSTER_LOAD_FAILED"
    | "TEXT_OVERFLOW";
  message: string;
  personId?: string;
};


function splitOrganizationSmart(orgName: string): { line1: string; line2: string } {
  const words = compactWhitespace(orgName).split(" ").filter(Boolean);
  if (words.length <= 1) return { line1: orgName, line2: "" };
  let bestIdx = 1;
  let bestMaxLen = Number.POSITIVE_INFINITY;
  for (let idx = 1; idx < words.length; idx += 1) {
    const l1 = words.slice(0, idx).join(" ");
    const l2 = words.slice(idx).join(" ");
    const maxLen = Math.max(l1.length, l2.length);
    if (maxLen < bestMaxLen) {
      bestMaxLen = maxLen;
      bestIdx = idx;
    }
  }
  return {
    line1: words.slice(0, bestIdx).join(" "),
    line2: words.slice(bestIdx).join(" "),
  };
}

function bindingValue(params: {
  binding: BadgeTextBindingKey;
  person: {
    displayName: string;
    firstName: string;
    lastName: string;
    roleTitle: string;
    organizationName: string;
    city: string;
    province: string;
  };
  computed: {
    orgLine1: string;
    orgLine2: string;
    firstName: string;
    lastName: string;
    roleTitle: string;
  };
}): string {
  const { binding, person, computed } = params;
  switch (binding) {
    case "computed.org_line_1":
      return computed.orgLine1;
    case "computed.org_line_2":
      return computed.orgLine2;
    case "computed.first_name":
      return computed.firstName;
    case "computed.last_name":
      return computed.lastName;
    case "computed.role_title":
      return computed.roleTitle;
    case "person.display_name":
      return person.displayName;
    case "person.first_name":
      return person.firstName;
    case "person.last_name":
      return person.lastName;
    case "person.role_title":
      return person.roleTitle;
    case "person.organization_name":
      return person.organizationName;
    case "person.city":
      return person.city;
    case "person.province":
      return person.province;
    default:
      return "";
  }
}


function personLabel(firstName: string, lastName: string, displayName: string, personId: string): string {
  const full = compactWhitespace(`${firstName} ${lastName}`);
  if (full) return full;
  if (displayName) return displayName;
  return personId;
}

async function runBadgePreflight(params: {
  conferenceId: string;
  personId?: string | null;
  templateVersion?: number | null;
}): Promise<BadgePreflightIssue[]> {
  const db = createAdminClient();
  const issues: BadgePreflightIssue[] = [];

  // Every column named here must exist on conference_people. This select
  // carried eight that the v3 cutover removed — first_name, last_name,
  // delegate_title, organization_name, badge_org_name, badge_organization_id,
  // city, province — and Postgres rejects the whole statement on the first of
  // them. Because the result was read as `.data ?? []` with no error check,
  // that hard failure surfaced as "0 people, 0 issues, preflight passed" on
  // every run. Name and title resolve from `contacts`, org/city/province from
  // `organizations`; the fallback chain below already preferred both sources.
  // The roster is resolved in ONE place — lib/conference/badges/roster.ts. This
  // function used to rebuild it inline: its own people query, its own contacts
  // and organizations lookups, and its own `person_kind` → role mapping. That
  // made four independent answers to "what kind of badge is this" across the
  // print pipeline, and preflight was checking a different one than the PDF
  // rendered.
  let run: Awaited<ReturnType<typeof resolveBadgeRun>>;
  try {
    run = await resolveBadgeRun(params.conferenceId);
  } catch (error) {
    return [
      {
        code: "ROSTER_LOAD_FAILED",
        message: error instanceof Error ? error.message : "Could not load the conference roster.",
      },
    ];
  }
  // Walk the run forwards: each type, then the seats somebody is named to. An
  // unnamed seat has no text to overflow and no identity to be missing, so it
  // is simply not a badge to check.
  const entries = run.types.flatMap((type) =>
    type.seats
      .filter((seat) => seat.person)
      .filter((seat) => !params.personId?.trim() || seat.person!.personId === params.personId)
      .map((seat) => ({ type, person: seat.person! }))
  );

  for (const { person } of entries) {
    if (!person.hasIdentityLink) {
      issues.push({
        code: "MISSING_CANONICAL_PERSON",
        message: "Conference person is missing canonical person linkage.",
        personId: person.personId,
      });
    }
  }

  const configQuery = db
    .from("badge_template_configs")
    .select("field_mapping")
    .eq("conference_id", params.conferenceId);
  let configResult =
    params.templateVersion && Number.isFinite(params.templateVersion)
      ? await configQuery.eq("config_version", params.templateVersion).maybeSingle()
      : await configQuery
          .eq("status", "active")
          .order("config_version", { ascending: false })
          .limit(1)
          .maybeSingle();

  // Reprint/edit flows must remain usable while template is still draft.
  if (!params.templateVersion && !configResult.data) {
    configResult = await db
      .from("badge_template_configs")
      .select("field_mapping")
      .eq("conference_id", params.conferenceId)
      .order("config_version", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  if (!configResult.data) {
    issues.push({
      code: "MISSING_TEMPLATE",
      message: "No badge template found for preflight.",
    });
    return issues;
  }
  // Resilient mode: overlay assets are optional. Renderer already handles null overlays.
  const template = normalizeBadgeTemplateConfig(configResult.data.field_mapping ?? null);

  for (const entry of entries) {
    const personId = entry.person.personId;
    // The layout IS the registration type being iterated. Nothing is derived.
    const { front } = resolveBadgeVariant(template, { variantKey: entry.type.entityId });
    const { displayName, firstName, lastName, roleTitle } = entry.person;
    const seat = entry.type.seats.find((s) => s.person?.personId === personId);
    const organizationName = seat?.organizationName ?? "";
    const city = seat?.organizationCity ?? "";
    const province = seat?.organizationProvince ?? "";
    const orgSplit = splitOrganizationSmart(organizationName.toUpperCase());
    const computedFirst = front.firstName.allCaps ? firstName.toUpperCase() : firstName;
    const computedLast = front.lastName.allCaps ? lastName.toUpperCase() : lastName;
    const computedRole = compactWhitespace(roleTitle);
    const person = {
      displayName,
      firstName,
      lastName,
      roleTitle,
      organizationName,
      city,
      province,
    };
    const computed = {
      orgLine1: orgSplit.line1,
      orgLine2: orgSplit.line2,
      firstName: computedFirst,
      lastName: computedLast,
      roleTitle: computedRole,
    };
    const checks: Array<{ field: string; value: string; slot: BadgeFrontConfig["firstName"]; maxLines: number }> = [
      {
        field: "organizationLine1",
        value: bindingValue({
          binding: front.bindings.organizationLine1,
          person,
          computed,
        }),
        slot: front.organizationLine1,
        maxLines: front.organizationLine1.maxLines ?? 1,
      },
      {
        field: "organizationLine2",
        value: bindingValue({
          binding: front.bindings.organizationLine2,
          person,
          computed,
        }),
        slot: front.organizationLine2,
        maxLines: front.organizationLine2.maxLines ?? 1,
      },
      {
        field: "firstName",
        value: bindingValue({
          binding: front.bindings.firstName,
          person,
          computed,
        }),
        slot: front.firstName,
        maxLines: 1,
      },
      {
        field: "lastName",
        value: bindingValue({
          binding: front.bindings.lastName,
          person,
          computed,
        }),
        slot: front.lastName,
        maxLines: front.lastName.maxLines ?? 2,
      },
      {
        field: "title",
        value: bindingValue({
          binding: front.bindings.title,
          person,
          computed,
        }),
        slot: front.title,
        maxLines: front.title.maxLines ?? 3,
      },
    ];

    for (const check of checks) {
      const layout = fitTextLayout(check.value, check.slot, template.canvas.dpi, {
        maxLines: check.maxLines,
        lineHeightEm: check.slot.lineHeight ?? 1.12,
      });
      if (!layout.overflowed) continue;
      issues.push({
        code: "TEXT_OVERFLOW",
        personId,
        message: `${personLabel(firstName, lastName, displayName, personId)}: ${check.field} does not fully fit its text box.`,
      });
    }
  }

  return issues;
}

export async function ensureBadgeTokenForPerson(params: {
  conferenceId: string;
  personId: string;
}): Promise<{ success: boolean; error?: string; data?: { tokenId: string; qrPayload: string } }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db.rpc("ensure_conference_badge_token_for_person", {
    p_conference_id: params.conferenceId,
    p_person_id: params.personId,
    p_actor_id: auth.ctx.userId,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      error: error?.message ?? "Failed to ensure conference badge token.",
    };
  }

  const row = data[0] as { token_id: string; qr_payload: string };
  return {
    success: true,
    data: { tokenId: row.token_id, qrPayload: row.qr_payload },
  };
}

export async function listBadgePrintJobs(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: Record<string, unknown>[];
}> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("badge_print_jobs")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function listBadgeTemplateConfigs(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: Record<string, unknown>[];
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("badge_template_configs")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("config_version", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function getBadgeSetupSession(conferenceId: string): Promise<{
  success: boolean;
  error?: string;
  data?: { state: BadgeSetupSessionState; lastStep: number; status: "draft" | "ready" | "archived" } | null;
}> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("badge_setup_sessions")
    .select("state_json, last_step, status")
    .eq("conference_id", conferenceId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: true, data: null };
  return {
    success: true,
    data: {
      state: (data.state_json as BadgeSetupSessionState | null) ?? {},
      lastStep: Number(data.last_step ?? 1),
      status: ((data.status as "draft" | "ready" | "archived" | null) ?? "draft"),
    },
  };
}

export async function saveBadgeSetupSession(params: {
  conferenceId: string;
  state: BadgeSetupSessionState;
  lastStep: number;
  status?: "draft" | "ready" | "archived";
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const boundedStep = Math.min(10, Math.max(1, Math.floor(params.lastStep || 1)));
  const status = params.status ?? "draft";

  const { error } = await db.from("badge_setup_sessions").upsert(
    {
      conference_id: params.conferenceId,
      state_json: params.state,
      last_step: boundedStep,
      status,
      updated_at: new Date().toISOString(),
      updated_by: auth.ctx.userId,
    },
    { onConflict: "conference_id" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function saveBadgeTemplateConfig(params: {
  conferenceId: string;
  configVersion: number;
  name: string;
  status: "draft" | "active" | "archived";
  fieldMapping: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  if (params.status === "active") {
    await db
      .from("badge_template_configs")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("conference_id", params.conferenceId)
      .eq("status", "active");
  }

  const { error } = await db.from("badge_template_configs").upsert(
    {
      conference_id: params.conferenceId,
      config_version: params.configVersion,
      name: params.name,
      status: params.status,
      field_mapping: params.fieldMapping as unknown as import("@/lib/database.types").Json,
      created_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conference_id,config_version" }
  );

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "badge_template_config_save",
    entityType: "conference_instance",
    entityId: params.conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      configVersion: params.configVersion,
      status: params.status,
      name: params.name,
    },
  });

  return { success: true };
}

async function insertBadgeEvent(params: {
  jobId: string;
  conferenceId: string;
  personId: string | null;
  eventType: string;
  eventStatus: "info" | "success" | "error";
  message: string;
  actorId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const db = createAdminClient();
  await db.from("badge_print_events").insert({
    job_id: params.jobId,
    conference_id: params.conferenceId,
    person_id: params.personId,
    event_type: params.eventType,
    event_status: params.eventStatus,
    message: params.message,
    actor_id: params.actorId,
    payload: (params.payload ?? {}) as unknown as import("@/lib/database.types").Json,
  });
}

export async function createPreprintedBadgeJob(params: {
  conferenceId: string;
  templateVersion: number | null;
  delegateOrderMode?: DelegateBatchOrderMode;
  delegateOrderDirection?: "asc" | "desc";
  exhibitorOrderMode?: ExhibitorBatchOrderMode;
  exhibitorOrderDirection?: "asc" | "desc";
}): Promise<{
  success: boolean;
  error?: string;
  data?: { jobId: string; warningCount?: number; warningSample?: string[] };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const nowIso = new Date().toISOString();
  const delegateOrderMode = params.delegateOrderMode ?? "delegate_last_name";
  const exhibitorOrderMode = params.exhibitorOrderMode ?? "exhibitor_org_name";
  const delegateOrderDirection = params.delegateOrderDirection ?? "asc";
  const exhibitorOrderDirection = params.exhibitorOrderDirection ?? "asc";
  const preflightIssues = await runBadgePreflight({
    conferenceId: params.conferenceId,
    templateVersion: params.templateVersion,
  });
  const blockingIssues = preflightIssues.filter(
    (issue) => issue.code !== "TEXT_OVERFLOW"
  );
  const warningIssues = preflightIssues.filter(
    (issue) => issue.code === "TEXT_OVERFLOW"
  );
  if (blockingIssues.length > 0) {
    const sample = blockingIssues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(" | ");
    return {
      success: false,
      error: `Badge preflight failed with ${blockingIssues.length} blocking issue(s): ${sample}`,
      data: undefined,
    };
  }

  const { data: job, error } = await db
    .from("badge_print_jobs")
    .insert({
      conference_id: params.conferenceId,
      person_id: null,
      pipeline_type: "preprinted",
      status: "queued",
      transport_method: "pdf",
      batch_order_mode: null,
      batch_order_direction: null,
      template_version: params.templateVersion,
      initiated_by: auth.ctx.userId,
      metadata: {
        ordering: {
          delegate: {
            mode: delegateOrderMode,
            direction: delegateOrderDirection,
          },
          exhibitor: {
            mode: exhibitorOrderMode,
            direction: exhibitorOrderDirection,
          },
        },
      },
      started_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error || !job) {
    return { success: false, error: error?.message ?? "Failed to create badge job." };
  }

  await insertBadgeEvent({
    jobId: job.id,
    conferenceId: params.conferenceId,
    personId: null,
    eventType: "queued",
    eventStatus: "info",
    message: "Preprinted badge job queued.",
    actorId: auth.ctx.userId,
  });
  if (warningIssues.length > 0) {
    const warningSample = warningIssues.slice(0, 5).map((issue) => issue.message);
    await insertBadgeEvent({
      jobId: job.id,
      conferenceId: params.conferenceId,
      personId: null,
      eventType: "preflight_warning",
      eventStatus: "error",
      message: `Preflight flagged ${warningIssues.length} text-fit warning(s). Review Studio and fix text-box sizing/content before final print.`,
      actorId: auth.ctx.userId,
      payload: { warnings: warningSample },
    });
  }

  await db
    .from("badge_print_jobs")
    .update({
      status: "pdf_generated",
      output_artifact_url: `/api/admin/conference/${params.conferenceId}/badges/jobs/${job.id}/pdf`,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await insertBadgeEvent({
    jobId: job.id,
    conferenceId: params.conferenceId,
    personId: null,
    eventType: "pdf_generated",
    eventStatus: "success",
    message: "PDF package generated.",
    actorId: auth.ctx.userId,
  });

  await logAuditEventSafe({
    action: "badge_print_job_create",
    entityType: "badge_print_job",
    entityId: job.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      pipelineType: "preprinted",
      status: "pdf_generated",
      delegateOrderMode,
      delegateOrderDirection,
      exhibitorOrderMode,
      exhibitorOrderDirection,
      templateVersion: params.templateVersion,
    },
  });

  return {
    success: true,
    data: {
      jobId: job.id,
      warningCount: warningIssues.length,
      warningSample: warningIssues.slice(0, 3).map((issue) => issue.message),
    },
  };
}

export async function advanceBadgePrintJob(params: {
  jobId: string;
  nextStatus: BadgeJobStatus;
  message?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: job, error: loadError } = await db
    .from("badge_print_jobs")
    .select("id, conference_id, person_id, status")
    .eq("id", params.jobId)
    .maybeSingle();

  if (loadError || !job) {
    return { success: false, error: loadError?.message ?? "Badge print job not found." };
  }

  const fromStatus = job.status as BadgeJobStatus;
  if (!validateBadgeJobTransition(fromStatus, params.nextStatus)) {
    return {
      success: false,
      error: `Invalid badge job transition: ${fromStatus} -> ${params.nextStatus}.`,
    };
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: params.nextStatus,
    updated_at: nowIso,
  };
  if (params.nextStatus === "rendering") patch.started_at = nowIso;
  if (["printed", "failed", "canceled", "delivered", "pdf_generated"].includes(params.nextStatus)) {
    patch.completed_at = nowIso;
  }

  const { error: updateError } = await db
    .from("badge_print_jobs")
    .update(patch)
    .eq("id", params.jobId);
  if (updateError) return { success: false, error: updateError.message };

  await insertBadgeEvent({
    jobId: params.jobId,
    conferenceId: job.conference_id,
    personId: job.person_id,
    eventType: params.nextStatus,
    eventStatus: params.nextStatus === "failed" ? "error" : "success",
    message: params.message ?? `Badge job moved to ${params.nextStatus}.`,
    actorId: auth.ctx.userId,
  });

  return { success: true };
}

export async function requestBadgeReprint(params: {
  conferenceId: string;
  personId: string;
  reason: string;
  note?: string | null;
  transportMethod: "pdf" | "printer_bridge";
}): Promise<{
  success: boolean;
  error?: string;
  data?: {
    jobId: string;
    qrPayload: string;
    warningCount?: number;
    warningSample?: string[];
  };
}> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!isBadgeReprintReason(params.reason)) {
    return {
      success: false,
      error: "Reprint reason must be one of: damaged, lost, name_change, ops_override.",
    };
  }

  const token = await ensureBadgeTokenForPerson({
    conferenceId: params.conferenceId,
    personId: params.personId,
  });
  if (!token.success || !token.data) {
    return { success: false, error: token.error ?? "Failed to create badge token." };
  }

  const db = createAdminClient();
  const preflightIssues = await runBadgePreflight({
    conferenceId: params.conferenceId,
    personId: params.personId,
    templateVersion: null,
  });
  const blockingIssues = preflightIssues.filter(
    (issue) => issue.code !== "TEXT_OVERFLOW"
  );
  const warningIssues = preflightIssues.filter(
    (issue) => issue.code === "TEXT_OVERFLOW"
  );
  if (blockingIssues.length > 0) {
    const sample = blockingIssues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(" | ");
    return {
      success: false,
      error: `Badge reprint preflight failed with ${blockingIssues.length} blocking issue(s): ${sample}`,
    };
  }
  const nowIso = new Date().toISOString();

  const { data: job, error } = await db
    .from("badge_print_jobs")
    .insert({
      conference_id: params.conferenceId,
      person_id: params.personId,
      pipeline_type: "onsite_reprint",
      status: "queued",
      transport_method: params.transportMethod,
      reprint_reason: params.reason,
      reprint_note: params.note ?? null,
      initiated_by: auth.ctx.userId,
      metadata: {
        qr_payload: token.data.qrPayload,
        token_id: token.data.tokenId,
      },
      started_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error || !job) {
    return { success: false, error: error?.message ?? "Failed to create reprint job." };
  }

  await insertBadgeEvent({
    jobId: job.id,
    conferenceId: params.conferenceId,
    personId: params.personId,
    eventType: "reprint_requested",
    eventStatus: "info",
    message: `Reprint requested (${params.reason}).`,
    actorId: auth.ctx.userId,
    payload: { note: params.note ?? null, qrPayload: token.data.qrPayload },
  });
  if (warningIssues.length > 0) {
    const warningSample = warningIssues.slice(0, 5).map((issue) => issue.message);
    await insertBadgeEvent({
      jobId: job.id,
      conferenceId: params.conferenceId,
      personId: params.personId,
      eventType: "preflight_warning",
      eventStatus: "error",
      message: `Reprint preflight flagged ${warningIssues.length} text-fit warning(s). Review text layout before printing.`,
      actorId: auth.ctx.userId,
      payload: { warnings: warningSample },
    });
  }

  // v1.0: PDF fallback is always available; printer bridge path can continue from sent_to_printer.
  const nextStatus = params.transportMethod === "pdf" ? "pdf_generated" : "sent_to_printer";
  await db
    .from("badge_print_jobs")
    .update({
      status: nextStatus,
      output_artifact_url:
        params.transportMethod === "pdf"
          ? `/api/admin/conference/${params.conferenceId}/badges/jobs/${job.id}/pdf`
          : null,
      completed_at: params.transportMethod === "pdf" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await insertBadgeEvent({
    jobId: job.id,
    conferenceId: params.conferenceId,
    personId: params.personId,
    eventType: nextStatus,
    eventStatus: "success",
    message:
      nextStatus === "pdf_generated"
        ? "Reprint PDF generated."
        : "Reprint sent to printer bridge queue.",
    actorId: auth.ctx.userId,
  });

  await logAuditEventSafe({
    action: "badge_reprint_request",
    entityType: "badge_print_job",
    entityId: job.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      personId: params.personId,
      reason: params.reason,
      transportMethod: params.transportMethod,
    },
  });

  return {
    success: true,
    data: {
      jobId: job.id,
      qrPayload: token.data.qrPayload,
      warningCount: warningIssues.length,
      warningSample: warningIssues.slice(0, 3).map((issue) => issue.message),
    },
  };
}

export async function deleteBadgePrintJob(params: {
  conferenceId: string;
  jobId: string;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const reason = params.reason.trim();
  if (reason.length < 8) {
    return { success: false, error: "Deletion reason must be at least 8 characters." };
  }

  const db = createAdminClient();
  const { data: job, error: loadError } = await db
    .from("badge_print_jobs")
    .select("id, conference_id, status, pipeline_type, transport_method, output_artifact_url")
    .eq("id", params.jobId)
    .eq("conference_id", params.conferenceId)
    .maybeSingle();

  if (loadError || !job) {
    return { success: false, error: loadError?.message ?? "Badge print job not found." };
  }

  if (job.status === "rendering") {
    return {
      success: false,
      error: "Cannot delete a badge job while it is rendering. Mark failed/canceled first.",
    };
  }

  const { error: deleteError } = await db
    .from("badge_print_jobs")
    .delete()
    .eq("id", params.jobId)
    .eq("conference_id", params.conferenceId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  await logAuditEventSafe({
    action: "badge_print_job_delete",
    entityType: "badge_print_job",
    entityId: params.jobId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      reason,
      previousStatus: job.status,
      pipelineType: job.pipeline_type,
      transportMethod: job.transport_method,
      outputArtifactUrl: job.output_artifact_url,
    },
  });

  return { success: true };
}
