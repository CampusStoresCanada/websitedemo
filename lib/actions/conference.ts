"use server";

import { isSuperAdmin, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import {
  CONFERENCE_STATUS_TRANSITIONS,
  PUBLIC_CONFERENCE_STATUSES,
  type ConferenceStatus,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type ConferenceInsert = Database["public"]["Tables"]["conference_instances"]["Insert"];
type ConferenceUpdate = Database["public"]["Tables"]["conference_instances"]["Update"];

type ConferenceWithRelations = ConferenceRow & {
  conference_parameters: Database["public"]["Tables"]["conference_parameters"]["Row"][];
  conference_products: Database["public"]["Tables"]["conference_products"]["Row"][];
};

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
    .select("*, conference_parameters(*), conference_products(*)")
    .eq("id", id)
    .single();

  if (error) return { success: false, error: error.message };
  const row = data as unknown as ConferenceWithRelations & {
    conference_parameters?: ConferenceWithRelations["conference_parameters"] | null;
    conference_products?: ConferenceWithRelations["conference_products"] | null;
  };
  return {
    success: true,
    data: {
      ...row,
      conference_parameters: row.conference_parameters ?? [],
      conference_products: row.conference_products ?? [],
    },
  };
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
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await auth.ctx.supabase
    .from("conference_instances")
    .select("*, conference_parameters(*), conference_products(*)")
    .eq("year", year)
    .eq("edition_code", edition)
    .in("status", PUBLIC_CONFERENCE_STATUSES)
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as unknown as ConferenceWithRelations };
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

export async function transitionConferenceStatus(
  id: string,
  newStatus: ConferenceStatus
): Promise<{ success: boolean; error?: string; data?: ConferenceRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

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

  if (currentStatus === "draft" && newStatus === "registration_open") {
    const setupErrors: string[] = [];

    const [{ data: params }, { data: products }, { data: legalDocs }, { data: confMeta }] =
      await Promise.all([
        adminClient
          .from("conference_parameters")
          .select("id")
          .eq("conference_id", id)
          .maybeSingle(),
        adminClient
          .from("conference_products")
          .select("id")
          .eq("conference_id", id)
          .eq("is_active", true),
        adminClient
          .from("conference_legal_versions")
          .select("id")
          .eq("conference_id", id),
        adminClient
          .from("conference_instances")
          .select("start_date, end_date, registration_open_at, registration_close_at")
          .eq("id", id)
          .single(),
      ]);

    if (!params) setupErrors.push("Conference parameters must be configured first.");
    if (!products || products.length === 0) {
      setupErrors.push("At least one active conference product is required.");
    }
    if (!legalDocs || legalDocs.length === 0) {
      setupErrors.push("At least one legal document version is required.");
    }
    if (!confMeta?.start_date || !confMeta?.end_date) {
      setupErrors.push("Conference start and end dates are required.");
    }
    if (!confMeta?.registration_open_at || !confMeta?.registration_close_at) {
      setupErrors.push("Registration open/close timestamps are required.");
    }

    if (setupErrors.length > 0) {
      return {
        success: false,
        error: `Cannot open registration: ${setupErrors.join(" ")}`,
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
  return { success: true, data };
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

  // 3. Copy parameters
  const { data: params } = await adminClient
    .from("conference_parameters")
    .select("*")
    .eq("conference_id", sourceConferenceId)
    .maybeSingle();

  if (params) {
    await adminClient.from("conference_parameters").insert({
      conference_id: newConf.id,
      conference_days: params.conference_days,
      meeting_slots_per_day: params.meeting_slots_per_day,
      slot_duration_minutes: params.slot_duration_minutes,
      slot_buffer_minutes: params.slot_buffer_minutes,
      meeting_start_time: params.meeting_start_time,
      meeting_end_time: params.meeting_end_time,
      flex_time_start: params.flex_time_start,
      flex_time_end: params.flex_time_end,
      total_meeting_suites: params.total_meeting_suites,
      delegate_target_meetings: params.delegate_target_meetings,
    });
  }

  // 4. Copy products (reset current_sold to 0)
  const { data: products } = await adminClient
    .from("conference_products")
    .select("*")
    .eq("conference_id", sourceConferenceId);

  const productIdMap = new Map<string, string>(); // old id → new id
  if (products && products.length > 0) {
    for (const p of products) {
      const { data: newProduct } = await adminClient
        .from("conference_products")
        .insert({
          conference_id: newConf.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          price_cents: p.price_cents,
          currency: p.currency,
          is_taxable: p.is_taxable,
          is_tax_exempt: p.is_tax_exempt,
          capacity: p.capacity,
          current_sold: 0,
          max_per_account: p.max_per_account,
          display_order: p.display_order,
          is_active: p.is_active,
          metadata: p.metadata,
        })
        .select("id")
        .single();

      if (newProduct) {
        productIdMap.set(p.id, newProduct.id);
      }
    }
  }

  // 5. Copy product rules (with updated product_id references)
  if (products && products.length > 0) {
    for (const p of products) {
      const { data: rules } = await adminClient
        .from("conference_product_rules")
        .select("*")
        .eq("product_id", p.id);

      if (rules && rules.length > 0) {
        const newProductId = productIdMap.get(p.id);
        if (newProductId) {
          await adminClient.from("conference_product_rules").insert(
            rules.map((r) => ({
              product_id: newProductId,
              rule_type: r.rule_type,
              rule_config: r.rule_config,
              error_message: r.error_message,
              display_order: r.display_order,
            }))
          );
        }
      }
    }
  }

  // 6. Copy legal versions (new versions, not copies)
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

  // 7. Flag required edits
  const flaggedEdits = [
    "Review and update product prices",
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

// ─────────────────────────────────────────────────────────────────
// Admin: Create or update conference parameters
// ─────────────────────────────────────────────────────────────────

type ParamsInsert = Database["public"]["Tables"]["conference_parameters"]["Insert"];
type ParamsRow = Database["public"]["Tables"]["conference_parameters"]["Row"];

export async function upsertConferenceParameters(
  conferenceId: string,
  input: Omit<ParamsInsert, "id" | "conference_id" | "created_at" | "updated_at">
): Promise<{ success: boolean; error?: string; data?: ParamsRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Check if params already exist
  const { data: existing } = await adminClient
    .from("conference_parameters")
    .select("id")
    .eq("conference_id", conferenceId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await adminClient
      .from("conference_parameters")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("conference_id", conferenceId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  }

  const { data, error } = await adminClient
    .from("conference_parameters")
    .insert({ ...input, conference_id: conferenceId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}
