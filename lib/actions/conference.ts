"use server";

import { isGlobalAdmin, isSuperAdmin, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe, type AuditActorType } from "@/lib/ops/audit";
import {
  CONFERENCE_STATUS_TRANSITIONS,
  VISIBLE_CONFERENCE_STATUSES,
  type ConferenceStatus,
} from "@/lib/constants/conference";
import { loadLaunchReadinessInput } from "@/lib/actions/conference-launch";
import { computeLaunchReadiness, launchBlockers, computeAnnounceReadiness } from "@/lib/conference/launch-readiness";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type ConferenceInsert = Database["public"]["Tables"]["conference_instances"]["Insert"];
type ConferenceUpdate = Database["public"]["Tables"]["conference_instances"]["Update"];

// Conference rows no longer carry catalog/parameters relations — the v3 entity
// graph is the catalog, and meeting setup lives on Suite/Day things.
type ConferenceWithRelations = ConferenceRow;

// ─────────────────────────────────────────────────────────────────
// Admin: List all conferences
// ─────────────────────────────────────────────────────────────────

export async function getConferences(): Promise<{
  success: boolean;
  error?: string;
  data?: ConferenceRow[];
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_instances")
    .select("*")
    .order("year", { ascending: false })
    .order("edition_code", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Get single conference with params + products
// ─────────────────────────────────────────────────────────────────

export async function getConference(id: string): Promise<{
  success: boolean;
  error?: string;
  data?: ConferenceWithRelations;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_instances")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as ConferenceWithRelations };
}

// ─────────────────────────────────────────────────────────────────
// Public: Get conference by year + edition (registration_open+)
// ─────────────────────────────────────────────────────────────────

export async function getPublicConference(
  year: number,
  edition: string
): Promise<{
  success: boolean;
  error?: string;
  data?: ConferenceWithRelations;
  isDraftPreview?: boolean;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Admins/super admins can preview a conference before it's publicly visible,
  // as can the dedicated test orgs used for pre-launch QA.
  const canPreviewUnpublished =
    isGlobalAdmin(auth.ctx.globalRole) || hasDraftPreviewAccess(auth.ctx.activeOrgIds);

  const adminClient = createAdminClient();
  let query = adminClient
    .from("conference_instances")
    .select("*")
    .eq("year", year)
    .eq("edition_code", edition);

  if (!canPreviewUnpublished) {
    query = query.in("status", VISIBLE_CONFERENCE_STATUSES);
  }

  const { data, error } = await query.single();

  if (error) return { success: false, error: error.message };
  const conference = data as unknown as ConferenceWithRelations;
  const isDraftPreview =
    canPreviewUnpublished &&
    !(VISIBLE_CONFERENCE_STATUSES as readonly string[]).includes(conference.status);

  return { success: true, data: conference, isDraftPreview };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Create conference
// ─────────────────────────────────────────────────────────────────

export async function createConference(
  input: Omit<ConferenceInsert, "id" | "created_at" | "updated_at" | "created_by">
): Promise<{ success: boolean; error?: string; data?: ConferenceRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_instances")
    .insert({ ...input, created_by: auth.ctx.userId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Update conference
// ─────────────────────────────────────────────────────────────────

const CONFERENCE_UPDATE_FIELDS = [
  "name",
  "year",
  "edition_code",
  "location_city",
  "location_province",
  "location_venue",
  "timezone",
  "tax_jurisdiction",
  "tax_rate_pct",
  "stripe_tax_rate_id",
  "start_date",
  "end_date",
  "registration_open_at",
  "registration_close_at",
  "on_sale_at",
  "board_decision_at",
] as const;

export async function updateConference(
  id: string,
  input: ConferenceUpdate,
  options?: {
    superAdminOverride?: boolean;
    overrideReason?: string | null;
  }
): Promise<{ success: boolean; error?: string; data?: ConferenceRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: current, error: currentError } = await adminClient
    .from("conference_instances")
    .select("id, status")
    .eq("id", id)
    .single();

  if (currentError || !current) {
    return { success: false, error: currentError?.message ?? "Conference not found" };
  }

  const isSuper = isSuperAdmin(auth.ctx.globalRole);
  const requestedOverride = options?.superAdminOverride === true;
  const isNonDraft = current.status !== "draft";

  if (isNonDraft && !requestedOverride) {
    return {
      success: false,
      error:
        "Conference details are locked after draft. Super admin override is required to edit these fields.",
    };
  }

  if (requestedOverride && !isSuper) {
    return { success: false, error: "Only super admins can use conference detail override." };
  }

  // Only allow certain fields to be updated
  const filtered: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of CONFERENCE_UPDATE_FIELDS) {
    if (key in input) {
      filtered[key] = input[key as keyof ConferenceUpdate];
    }
  }

  const { data, error } = await adminClient
    .from("conference_instances")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  if (requestedOverride && data) {
    await logAuditEventSafe({
      action: "conference_details_override",
      entityType: "conference",
      entityId: id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        reason: options?.overrideReason?.trim() || null,
        previousStatus: current.status,
        changedFields: Object.keys(filtered).filter((key) => key !== "updated_at"),
      },
    });
  }

  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Transition conference status
// ─────────────────────────────────────────────────────────────────

/**
 * Core transition logic, no auth check — callable from a real admin's click
 * (transitionConferenceStatus below) or from the scheduled-transitions cron,
 * which has no live user session but was already authorized when a
 * super_admin approved the schedule. Re-validates legality against current
 * status every time it runs, so a manual change made in the meantime always
 * wins over a stale scheduled one — same guarantee transitionMembershipState
 * gives the renewal cron.
 */
export async function performConferenceStatusTransition(
  id: string,
  newStatus: ConferenceStatus,
  actor: { actorId: string | null; actorType: AuditActorType }
): Promise<{ success: boolean; error?: string; data?: ConferenceRow }> {
  const adminClient = createAdminClient();

  // Fetch current status
  const { data: current, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchError || !current) {
    return { success: false, error: fetchError?.message ?? "Conference not found" };
  }

  const currentStatus = current.status as ConferenceStatus;
  const allowed = CONFERENCE_STATUS_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from "${currentStatus}" to "${newStatus}"`,
    };
  }

  if (currentStatus === "draft" && newStatus === "announced") {
    // Light gate: just "do we know when this is" — not the full sell-readiness
    // bar. See computeAnnounceReadiness's doc comment for why.
    const readinessInput = await loadLaunchReadinessInput(id);
    if (!readinessInput.success) {
      return { success: false, error: readinessInput.error };
    }
    const announceReadiness = computeAnnounceReadiness(readinessInput.data);
    if (!announceReadiness.canAnnounce) {
      return {
        success: false,
        error: `Cannot announce: ${announceReadiness.blockers.join(" ")}`,
      };
    }
  }

  if (currentStatus === "announced" && newStatus === "registration_open") {
    // Unified gate: the same launch-readiness model the Overview checklist
    // renders. UI and gate can never disagree (the v1 failure mode).
    const readinessInput = await loadLaunchReadinessInput(id);
    if (!readinessInput.success) {
      return { success: false, error: readinessInput.error };
    }
    const readiness = computeLaunchReadiness(readinessInput.data);
    if (!readiness.canGoOnSale) {
      return {
        success: false,
        error: `Cannot open registration: ${launchBlockers(readiness).join(" ")}`,
      };
    }
  }

  const { data, error } = await adminClient
    .from("conference_instances")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "conference_status_transition",
    entityType: "conference",
    entityId: id,
    actorId: actor.actorId,
    actorType: actor.actorType,
    details: { fromStatus: currentStatus, toStatus: newStatus },
  });

  return { success: true, data };
}

export async function transitionConferenceStatus(
  id: string,
  newStatus: ConferenceStatus
): Promise<{ success: boolean; error?: string; data?: ConferenceRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  return performConferenceStatusTransition(id, newStatus, {
    actorId: auth.ctx.userId,
    actorType: "user",
  });
}

// ─────────────────────────────────────────────────────────────────
// Admin: Duplicate conference
// ─────────────────────────────────────────────────────────────────

export async function duplicateConference(
  sourceConferenceId: string,
  newYear: number
): Promise<{
  success: boolean;
  error?: string;
  data?: ConferenceRow;
  flaggedEdits?: string[];
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // 1. Load source conference
  const { data: source, error: srcErr } = await adminClient
    .from("conference_instances")
    .select("*")
    .eq("id", sourceConferenceId)
    .single();

  if (srcErr || !source) {
    return { success: false, error: srcErr?.message ?? "Source conference not found" };
  }

  // 2. Copy instance (reset status to draft)
  const { data: newConf, error: confErr } = await adminClient
    .from("conference_instances")
    .insert({
      name: source.name.replace(String(source.year), String(newYear)),
      year: newYear,
      edition_code: source.edition_code,
      status: "draft",
      location_city: source.location_city,
      location_province: source.location_province,
      location_venue: source.location_venue,
      timezone: source.timezone,
      tax_jurisdiction: source.tax_jurisdiction,
      tax_rate_pct: source.tax_rate_pct,
      duplicated_from_id: source.id,
      created_by: auth.ctx.userId,
    })
    .select()
    .single();

  if (confErr || !newConf) {
    return { success: false, error: confErr?.message ?? "Failed to create conference" };
  }

  // Meeting suites + cadence are v3 Suite/Day things now (not conference_parameters),
  // and are rebuilt per conference in the Catalog — nothing to copy here.

  // 3. Copy legal versions (new versions, not copies)
  const { data: legalVersions } = await adminClient
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", sourceConferenceId);

  if (legalVersions && legalVersions.length > 0) {
    await adminClient.from("conference_legal_versions").insert(
      legalVersions.map((lv) => ({
        conference_id: newConf.id,
        document_type: lv.document_type,
        version: 1, // new version 1 for the new conference
        content: lv.content,
        effective_at: new Date().toISOString(),
        created_by: auth.ctx.userId,
      }))
    );
  }

  // 5. Flag required edits
  const flaggedEdits = [
    "Build the v3 catalog (Catalog tab) — things, offers, and pricing",
    "Set new start_date and end_date",
    "Set registration_open_at and registration_close_at",
    "Verify tax_jurisdiction and tax_rate_pct",
    "Review legal document content for updates",
  ];

  return { success: true, data: newConf, flaggedEdits };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Delete conference (draft only)
// ─────────────────────────────────────────────────────────────────

export async function deleteConference(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Only allow deleting draft conferences
  const { data: conf, error: fetchErr } = await adminClient
    .from("conference_instances")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchErr || !conf) {
    return { success: false, error: fetchErr?.message ?? "Conference not found" };
  }

  if (conf.status !== "draft") {
    return { success: false, error: "Only draft conferences can be deleted" };
  }

  const { error } = await adminClient
    .from("conference_instances")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// conference_parameters was retired in the meetings→v3 migration (M0). Meeting
// suites + per-day cadence now live on Suite/Day things; the scheduler reads the
// graph. The table is dropped in M4.
