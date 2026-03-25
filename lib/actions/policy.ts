"use server";

import {
  requireAdmin,
  requireSuperAdmin,
} from "@/lib/auth/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPolicyCache } from "@/lib/policy/engine";
import type { PolicySet, PolicyValue } from "@/lib/policy/types";
import { logAuditEventSafe } from "@/lib/ops/audit";
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

const REQUIRED_BILLING_POLICY_DEFAULTS = [
  {
    key: "billing.proration_rules",
    type: "json",
    label: "Proration Cutoffs",
    description: "Proration discount rules by month/day cutoff.",
    value: [
      { after_month_day: "02-01", discount_pct: 50 },
      { after_month_day: "06-01", discount_pct: 75 },
    ],
    isHighRisk: true,
    displayOrder: 10,
  },
  {
    key: "billing.membership_tiers",
    type: "json",
    label: "Membership Pricing by FTE",
    description: "Tiered annual pricing by FTE band.",
    value: [
      { max_fte: 2500, price: 420 },
      { max_fte: 5000, price: 525 },
      { max_fte: 10000, price: 735 },
      { max_fte: 20000, price: 895 },
      { max_fte: null, price: 1000 },
    ],
    isHighRisk: true,
    displayOrder: 20,
  },
  {
    key: "billing.partnership_rate",
    type: "decimal",
    label: "Partnership Flat Rate",
    description: "Annual flat rate for vendor partners.",
    value: 600,
    isHighRisk: true,
    displayOrder: 30,
  },
  {
    key: "billing.downgrade_policy",
    type: "string",
    label: "Downgrade Timing",
    description: "When downgrades take effect.",
    value: "next_cycle",
    isHighRisk: false,
    displayOrder: 40,
  },
  {
    key: "billing.currency",
    type: "string",
    label: "Billing Currency",
    description: "Currency code used for billing.",
    value: "CAD",
    isHighRisk: false,
    displayOrder: 50,
  },
  {
    key: "billing.pricing_mode",
    type: "string",
    label: "Pricing Model",
    description: "Pricing algorithm mode.",
    value: "FTE_BUCKETS",
    isHighRisk: true,
    displayOrder: 60,
  },
  {
    key: "billing.formula_config",
    type: "json",
    label: "Formula Config",
    description: "Config for LINEAR_FORMULA mode.",
    value: {
      base: 300,
      multiplier: 0.08,
      min_price: 300,
      max_price: 2500,
      rounding: "nearest_dollar",
    },
    isHighRisk: true,
    displayOrder: 70,
  },
  {
    key: "billing.metric_key",
    type: "string",
    label: "Pricing Metric Key",
    description: "Data field path used for metric-driven pricing.",
    value: "organizations.fte",
    isHighRisk: true,
    displayOrder: 80,
  },
  {
    key: "billing.metric_allowlist",
    type: "string_array",
    label: "Allowed Metric Keys",
    description: "Allowed numeric metric fields for billing.metric_key.",
    value: ["organizations.fte"],
    isHighRisk: true,
    displayOrder: 90,
  },
  {
    key: "billing.fallback_price",
    type: "decimal",
    label: "Fallback Price",
    description: "Price used when required metric data is missing.",
    value: 1000,
    isHighRisk: true,
    displayOrder: 100,
  },
  {
    key: "billing.fallback_behavior",
    type: "string",
    label: "Fallback Behavior",
    description: "How pricing behaves when metric data is missing.",
    value: "use_fallback_price",
    isHighRisk: true,
    displayOrder: 110,
  },
  {
    key: "billing.rounding_rule",
    type: "string",
    label: "Rounding Rule",
    description: "Rounding behavior for computed prices.",
    value: "nearest_dollar",
    isHighRisk: true,
    displayOrder: 120,
  },
  {
    key: "billing.manual_override_allowed",
    type: "boolean",
    label: "Manual Override Allowed",
    description: "Allow admins to manually set computed prices.",
    value: true,
    isHighRisk: true,
    displayOrder: 130,
  },
  {
    key: "billing.override_persistence",
    type: "string",
    label: "Override Persistence",
    description: "How long manual overrides remain effective.",
    value: "cycle_only",
    isHighRisk: true,
    displayOrder: 140,
  },
] as const;

const REQUIRED_RETENTION_CONSENT_POLICY_DEFAULTS = [
  {
    key: "retention.travel_delete_rule",
    category: "retention",
    type: "string",
    label: "Travel Data Delete Rule",
    description: "Rule used to determine when travel fields are purged.",
    value: "march_1_conference_year_utc",
    isHighRisk: true,
    displayOrder: 10,
  },
  {
    key: "consent.travel_data_required",
    category: "retention",
    type: "boolean",
    label: "Travel Consent Required",
    description: "Require explicit consent before collecting travel data.",
    value: true,
    isHighRisk: true,
    displayOrder: 20,
  },
  {
    key: "consent.dietary_accessibility_required",
    category: "retention",
    type: "boolean",
    label: "Dietary/Accessibility Consent Required",
    description:
      "Require explicit consent before collecting dietary/accessibility fields.",
    value: false,
    isHighRisk: false,
    displayOrder: 30,
  },
] as const;

const REQUIRED_INTEGRATION_POLICY_DEFAULTS = [
  {
    key: "integration.conference_ops_masthead_org_ids",
    category: "integrations",
    type: "string_array",
    label: "Conference Ops Masthead Org IDs",
    description:
      "Organization IDs whose org_admin users can access the conference war-room tooling.",
    value: [] as string[],
    isHighRisk: true,
    displayOrder: 50,
  },
] as const;

type BillingPolicySeed = (typeof REQUIRED_BILLING_POLICY_DEFAULTS)[number];
type RetentionConsentPolicySeed =
  (typeof REQUIRED_RETENTION_CONSENT_POLICY_DEFAULTS)[number];
type IntegrationPolicySeed =
  (typeof REQUIRED_INTEGRATION_POLICY_DEFAULTS)[number];

async function ensureRequiredBillingPolicies(
  supabase: SupabaseClient<Database>,
  policySetId: string
): Promise<{ success: boolean; error?: string; insertedCount?: number }> {
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("policy_values")
    .select("key")
    .eq("policy_set_id", policySetId)
    .like("key", "billing.%");

  if (existingRowsError) {
    return {
      success: false,
      error: `Failed to inspect billing keys for policy set ${policySetId}: ${existingRowsError.message}`,
    };
  }

  const existingKeys = new Set((existingRows ?? []).map((row) => row.key));
  const missing = REQUIRED_BILLING_POLICY_DEFAULTS.filter(
    (item) => !existingKeys.has(item.key)
  );

  if (missing.length === 0) {
    return { success: true, insertedCount: 0 };
  }

  const rowsToInsert: Database["public"]["Tables"]["policy_values"]["Insert"][] =
    missing.map((item: BillingPolicySeed) => ({
      policy_set_id: policySetId,
      key: item.key,
      category: "billing",
      label: item.label,
      description: item.description,
      type: item.type,
      value_json: item.value as Database["public"]["Tables"]["policy_values"]["Insert"]["value_json"],
      validation_schema: null,
      is_high_risk: item.isHighRisk,
      display_order: item.displayOrder,
    }));

  const { error: insertError } = await supabase
    .from("policy_values")
    .insert(rowsToInsert);

  if (insertError) {
    return {
      success: false,
      error: `Failed to seed missing billing keys: ${insertError.message}`,
    };
  }

  return { success: true, insertedCount: missing.length };
}

async function ensureRequiredRetentionConsentPolicies(
  supabase: SupabaseClient<Database>,
  policySetId: string
): Promise<{ success: boolean; error?: string; insertedCount?: number }> {
  const keys = REQUIRED_RETENTION_CONSENT_POLICY_DEFAULTS.map((item) => item.key);
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("policy_values")
    .select("key")
    .eq("policy_set_id", policySetId)
    .in("key", keys);

  if (existingRowsError) {
    return {
      success: false,
      error: `Failed to inspect retention/consent keys for policy set ${policySetId}: ${existingRowsError.message}`,
    };
  }

  const existingKeys = new Set((existingRows ?? []).map((row) => row.key));
  const missing = REQUIRED_RETENTION_CONSENT_POLICY_DEFAULTS.filter(
    (item) => !existingKeys.has(item.key)
  );

  if (missing.length === 0) {
    return { success: true, insertedCount: 0 };
  }

  const rowsToInsert: Database["public"]["Tables"]["policy_values"]["Insert"][] =
    missing.map((item: RetentionConsentPolicySeed) => ({
      policy_set_id: policySetId,
      key: item.key,
      category: item.category,
      label: item.label,
      description: item.description,
      type: item.type,
      value_json:
        item.value as Database["public"]["Tables"]["policy_values"]["Insert"]["value_json"],
      validation_schema: null,
      is_high_risk: item.isHighRisk,
      display_order: item.displayOrder,
    }));

  const { error: insertError } = await supabase
    .from("policy_values")
    .insert(rowsToInsert);

  if (insertError) {
    return {
      success: false,
      error: `Failed to seed retention/consent keys: ${insertError.message}`,
    };
  }

  return { success: true, insertedCount: missing.length };
}

async function ensureRequiredIntegrationPolicies(
  supabase: SupabaseClient<Database>,
  policySetId: string
): Promise<{ success: boolean; error?: string; insertedCount?: number }> {
  const keys = REQUIRED_INTEGRATION_POLICY_DEFAULTS.map((item) => item.key);
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("policy_values")
    .select("key")
    .eq("policy_set_id", policySetId)
    .in("key", keys);

  if (existingRowsError) {
    return {
      success: false,
      error: `Failed to inspect integration keys for policy set ${policySetId}: ${existingRowsError.message}`,
    };
  }

  const existingKeys = new Set((existingRows ?? []).map((row) => row.key));
  const missing = REQUIRED_INTEGRATION_POLICY_DEFAULTS.filter(
    (item) => !existingKeys.has(item.key)
  );

  if (missing.length === 0) {
    return { success: true, insertedCount: 0 };
  }

  const rowsToInsert: Database["public"]["Tables"]["policy_values"]["Insert"][] =
    missing.map((item: IntegrationPolicySeed) => ({
      policy_set_id: policySetId,
      key: item.key,
      category: item.category,
      label: item.label,
      description: item.description,
      type: item.type,
      value_json:
        item.value as Database["public"]["Tables"]["policy_values"]["Insert"]["value_json"],
      validation_schema: null,
      is_high_risk: item.isHighRisk,
      display_order: item.displayOrder,
    }));

  const { error: insertError } = await supabase
    .from("policy_values")
    .insert(rowsToInsert);

  if (insertError) {
    return {
      success: false,
      error: `Failed to seed integration keys: ${insertError.message}`,
    };
  }

  return { success: true, insertedCount: missing.length };
}

// ─────────────────────────────────────────────────────────────────
// Auth Guards
// ─────────────────────────────────────────────────────────────────

interface AuthResult {
  authorized: boolean;
  userId?: string;
  error?: string;
  supabase?: SupabaseClient<Database>;
}

async function verifyAdminAccess(): Promise<AuthResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { authorized: false, error: auth.error };
  return { authorized: true, userId: auth.ctx.userId, supabase: createAdminClient() };
}

async function verifySuperAdminAccess(): Promise<AuthResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { authorized: false, error: auth.error };
  return { authorized: true, userId: auth.ctx.userId, supabase: createAdminClient() };
}

async function logPolicyAudit(params: {
  action: string;
  actorId?: string;
  entityId?: string | null;
  success: boolean;
  details?: Record<string, unknown>;
}) {
  await logAuditEventSafe({
    action: params.action,
    entityType: "policy_set",
    entityId: params.entityId ?? null,
    actorId: params.actorId ?? null,
    actorType: "user",
    details: {
      success: params.success,
      ...(params.details ?? {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

import type {
  PolicyDiff,
  ValidationError,
  ValidationResult,
  ImpactItem,
  ImpactPreview,
} from "./policy-types";

// ─────────────────────────────────────────────────────────────────
// Draft Management
// ─────────────────────────────────────────────────────────────────

/** Create a new draft from the current active/published set. */
export async function createPolicyDraft(
  name: string
): Promise<{ success: boolean; error?: string; data?: PolicySet }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  // Check no existing draft
  const { data: existingDraft, error: existingDraftError } = await supabase
    .from("policy_sets")
    .select("id, name")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDraftError) {
    return {
      success: false,
      error: `Failed to check existing drafts: ${existingDraftError.message}`,
    };
  }

  if (existingDraft) {
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      success: false,
      details: { reason: "draft_exists", existingDraftId: existingDraft.id },
    });
    return {
      success: false,
      error: `A draft already exists: "${existingDraft.name}". Edit or discard it first.`,
    };
  }

  // Find active set to copy from
  const { data: activeSet, error: activeSetError } = await supabase
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeSetError) {
    return {
      success: false,
      error: `Failed to resolve active policy set: ${activeSetError.message}`,
    };
  }

  if (!activeSet) {
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      success: false,
      details: { reason: "no_active_set" },
    });
    return { success: false, error: "No active policy set to base draft on" };
  }

  // Create draft set
  const { data: newDraft, error: insertError } = await supabase
    .from("policy_sets")
    .insert({
      name,
      status: "draft",
      is_active: false,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (insertError || !newDraft) {
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      success: false,
      details: { reason: "insert_failed", error: insertError?.message ?? null },
    });
    return {
      success: false,
      error: insertError?.message ?? "Failed to create draft",
    };
  }

  // Copy all values from active set
  const { data: activeValues, error: activeValuesError } = await supabase
    .from("policy_values")
    .select("*")
    .eq("policy_set_id", activeSet.id);

  if (activeValuesError) {
    await supabase.from("policy_sets").delete().eq("id", newDraft.id);
    return {
      success: false,
      error: `Failed to read active policy values: ${activeValuesError.message}`,
    };
  }

  if (activeValues && activeValues.length > 0) {
    const valuesToInsert = activeValues.map((v) => ({
      policy_set_id: newDraft.id,
      key: v.key,
      category: v.category,
      label: v.label,
      description: v.description,
      type: v.type,
      value_json: v.value_json,
      validation_schema: v.validation_schema,
      is_high_risk: v.is_high_risk,
      display_order: v.display_order,
    }));

    const { error: copyError } = await supabase
      .from("policy_values")
      .insert(valuesToInsert);

    if (copyError) {
      // Clean up the draft set if copy fails
      await supabase.from("policy_sets").delete().eq("id", newDraft.id);
      return {
        success: false,
        error: `Failed to copy policy values: ${copyError.message}`,
      };
    }
  }

  const billingSeedResult = await ensureRequiredBillingPolicies(supabase, newDraft.id);
  if (!billingSeedResult.success) {
    await supabase.from("policy_sets").delete().eq("id", newDraft.id);
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      entityId: newDraft.id,
      success: false,
      details: { reason: "billing_seed_failed", error: billingSeedResult.error ?? null },
    });
    return { success: false, error: billingSeedResult.error };
  }

  const retentionSeedResult = await ensureRequiredRetentionConsentPolicies(
    supabase,
    newDraft.id
  );
  if (!retentionSeedResult.success) {
    await supabase.from("policy_sets").delete().eq("id", newDraft.id);
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      entityId: newDraft.id,
      success: false,
      details: {
        reason: "retention_consent_seed_failed",
        error: retentionSeedResult.error ?? null,
      },
    });
    return { success: false, error: retentionSeedResult.error };
  }

  const integrationSeedResult = await ensureRequiredIntegrationPolicies(
    supabase,
    newDraft.id
  );
  if (!integrationSeedResult.success) {
    await supabase.from("policy_sets").delete().eq("id", newDraft.id);
    await logPolicyAudit({
      action: "policy_draft_create",
      actorId: auth.userId,
      entityId: newDraft.id,
      success: false,
      details: {
        reason: "integration_seed_failed",
        error: integrationSeedResult.error ?? null,
      },
    });
    return { success: false, error: integrationSeedResult.error };
  }

  await logPolicyAudit({
    action: "policy_draft_create",
    actorId: auth.userId,
    entityId: newDraft.id,
    success: true,
    details: { name },
  });
  return { success: true, data: newDraft as PolicySet };
}

/** Update a single value in a draft. */
export async function updateDraftValue(
  policySetId: string,
  key: string,
  newValue: unknown,
  reason?: string
): Promise<{ success: boolean; error?: string; data?: PolicyValue }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  // Verify it's a draft
  const { data: policySet } = await supabase
    .from("policy_sets")
    .select("status")
    .eq("id", policySetId)
    .single();

  if (!policySet || policySet.status !== "draft") {
    await logPolicyAudit({
      action: "policy_draft_value_update",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { key, reason: "not_draft" },
    });
    return { success: false, error: "Can only edit draft policy sets" };
  }

  // Fetch the current value row
  const { data: currentValue } = await supabase
    .from("policy_values")
    .select("*")
    .eq("policy_set_id", policySetId)
    .eq("key", key)
    .single();

  if (!currentValue) {
    await logPolicyAudit({
      action: "policy_draft_value_update",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { key, reason: "key_not_found" },
    });
    return { success: false, error: `Policy key "${key}" not found in draft` };
  }

  // Validate against schema if present
  if (currentValue.validation_schema) {
    const validate = ajv.compile(
      currentValue.validation_schema as Record<string, unknown>
    );
    if (!validate(newValue)) {
      const errorMsg = validate.errors
        ?.map((e) => `${e.instancePath || "value"} ${e.message}`)
        .join("; ");
      await logPolicyAudit({
        action: "policy_draft_value_update",
        actorId: auth.userId,
        entityId: policySetId,
        success: false,
        details: { key, reason: "validation_failed", error: errorMsg ?? null },
      });
      return { success: false, error: `Validation failed: ${errorMsg}` };
    }
  }

  // Update the value
  const { data: updated, error: updateError } = await supabase
    .from("policy_values")
    .update({ value_json: newValue as never, updated_at: new Date().toISOString() })
    .eq("policy_set_id", policySetId)
    .eq("key", key)
    .select()
    .single();

  if (updateError) {
    await logPolicyAudit({
      action: "policy_draft_value_update",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { key, reason: "update_failed", error: updateError.message },
    });
    return { success: false, error: updateError.message };
  }

  // Log the change
  await supabase.from("policy_change_log").insert({
    policy_set_id: policySetId,
    key,
    old_value_json: currentValue.value_json,
    new_value_json: newValue as never,
    changed_by: auth.userId!,
    reason: reason ?? null,
  });

  await logPolicyAudit({
    action: "policy_draft_value_update",
    actorId: auth.userId,
    entityId: policySetId,
    success: true,
    details: { key, reason: reason ?? null },
  });
  return { success: true, data: updated as PolicyValue };
}

/** Discard a draft (super_admin only). */
export async function discardDraft(
  policySetId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifySuperAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("policy_sets")
    .delete()
    .eq("id", policySetId)
    .eq("status", "draft");

  if (error) {
    await logPolicyAudit({
      action: "policy_draft_discard",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { error: error.message },
    });
    return { success: false, error: error.message };
  }
  await logPolicyAudit({
    action: "policy_draft_discard",
    actorId: auth.userId,
    entityId: policySetId,
    success: true,
  });
  return { success: true };
}

/** Seed missing billing keys into a draft policy set. */
export async function seedMissingBillingPolicies(
  policySetId: string
): Promise<{ success: boolean; error?: string; insertedCount?: number }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase) {
    return { success: false, error: auth.error };
  }

  const { data: setRow, error: setError } = await auth.supabase
    .from("policy_sets")
    .select("id, status")
    .eq("id", policySetId)
    .maybeSingle();

  if (setError) {
    await logPolicyAudit({
      action: "policy_billing_seed",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "set_load_failed", error: setError.message },
    });
    return {
      success: false,
      error: `Failed to load policy set: ${setError.message}`,
    };
  }

  if (!setRow) {
    await logPolicyAudit({
      action: "policy_billing_seed",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "set_not_found" },
    });
    return { success: false, error: "Policy set not found" };
  }

  if (setRow.status !== "draft") {
    await logPolicyAudit({
      action: "policy_billing_seed",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "not_draft" },
    });
    return {
      success: false,
      error: "Billing keys can only be seeded into a draft policy set",
    };
  }

  const result = await ensureRequiredBillingPolicies(auth.supabase, policySetId);
  if (!result.success) {
    await logPolicyAudit({
      action: "policy_billing_seed",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "seed_failed", error: result.error ?? null },
    });
    return { success: false, error: result.error };
  }

  await logPolicyAudit({
    action: "policy_billing_seed",
    actorId: auth.userId,
    entityId: policySetId,
    success: true,
    details: { insertedCount: result.insertedCount ?? 0 },
  });
  return {
    success: true,
    insertedCount: result.insertedCount ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

/** Validate all values in a draft against their schemas. */
export async function validateDraft(
  policySetId: string
): Promise<{ success: boolean; error?: string; data?: ValidationResult }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { data: values } = await auth.supabase
    .from("policy_values")
    .select("*")
    .eq("policy_set_id", policySetId);

  if (!values) return { success: false, error: "Failed to fetch draft values" };

  const errors: ValidationError[] = [];

  for (const val of values) {
    if (!val.validation_schema) continue;

    const validate = ajv.compile(
      val.validation_schema as Record<string, unknown>
    );
    if (!validate(val.value_json)) {
      errors.push({
        key: val.key,
        label: val.label,
        message:
          validate.errors
            ?.map((e) => `${e.instancePath || "value"} ${e.message}`)
            .join("; ") ?? "Invalid value",
      });
    }
  }

  return {
    success: true,
    data: { valid: errors.length === 0, errors },
  };
}

// ─────────────────────────────────────────────────────────────────
// Diff & Impact
// ─────────────────────────────────────────────────────────────────

/** Get diff between two policy sets. */
export async function getPolicyDiff(
  fromSetId: string,
  toSetId: string
): Promise<{ success: boolean; error?: string; data?: PolicyDiff[] }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  const [{ data: fromValues }, { data: toValues }] = await Promise.all([
    supabase.from("policy_values").select("*").eq("policy_set_id", fromSetId),
    supabase.from("policy_values").select("*").eq("policy_set_id", toSetId),
  ]);

  if (!fromValues || !toValues)
    return { success: false, error: "Failed to fetch values" };

  const fromMap = new Map(fromValues.map((v) => [v.key, v]));
  const diffs: PolicyDiff[] = [];

  for (const toVal of toValues) {
    const fromVal = fromMap.get(toVal.key);
    if (
      !fromVal ||
      JSON.stringify(fromVal.value_json) !== JSON.stringify(toVal.value_json)
    ) {
      diffs.push({
        key: toVal.key,
        label: toVal.label,
        category: toVal.category,
        oldValue: fromVal?.value_json ?? null,
        newValue: toVal.value_json,
        isHighRisk: toVal.is_high_risk,
      });
    }
  }

  return { success: true, data: diffs };
}

/** Get impact preview for a draft vs the active published set. */
export async function getImpactPreview(
  draftSetId: string
): Promise<{ success: boolean; error?: string; data?: ImpactPreview }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  // Find the active set to compare against
  const { data: activeSet } = await supabase
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .single();

  if (!activeSet) return { success: false, error: "No active policy set" };

  const diffResult = await getPolicyDiff(activeSet.id, draftSetId);
  if (!diffResult.success || !diffResult.data)
    return { success: false, error: diffResult.error };

  const changes = diffResult.data;
  const impacts: ImpactItem[] = [];

  for (const change of changes) {
    // Billing impact: count orgs per tier
    if (change.key === "billing.membership_tiers") {
      const { count } = await supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Member")
        .not("membership_status", "is", null);
      impacts.push({
        category: "billing",
        description: `Pricing tiers changed — ${count ?? 0} active member organizations affected`,
      });
    }

    if (change.key === "billing.partnership_rate") {
      const { count } = await supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("type", "Vendor Partner")
        .not("membership_status", "is", null);
      impacts.push({
        category: "billing",
        description: `Partnership rate: $${change.oldValue} → $${change.newValue} — ${count ?? 0} vendor partners affected`,
      });
    }

    // Renewal impact
    if (change.key === "renewal.grace_days") {
      impacts.push({
        category: "renewals",
        description: `Grace period: ${change.oldValue} → ${change.newValue} days`,
      });
    }

    if (change.key === "renewal.reactivation_days") {
      impacts.push({
        category: "renewals",
        description: `Reactivation window: ${change.oldValue} → ${change.newValue} days`,
      });
    }

    // Visibility impact
    if (change.key === "visibility.public_allowlist") {
      const oldList = (change.oldValue as string[]) ?? [];
      const newList = (change.newValue as string[]) ?? [];
      const added = newList.filter((f) => !oldList.includes(f));
      const removed = oldList.filter((f) => !newList.includes(f));
      if (added.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Making public: ${added.join(", ")}`,
        });
      }
      if (removed.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Making private: ${removed.join(", ")}`,
        });
      }
    }

    if (change.key === "visibility.private_fields") {
      const oldList = (change.oldValue as string[]) ?? [];
      const newList = (change.newValue as string[]) ?? [];
      const added = newList.filter((f) => !oldList.includes(f));
      const removed = oldList.filter((f) => !newList.includes(f));
      if (added.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Adding to private/blurred: ${added.join(", ")}`,
        });
      }
      if (removed.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Removing from private/blurred: ${removed.join(", ")}`,
        });
      }
    }

    // Visibility masking impact
    if (change.key === "visibility.masked_reveal_fields") {
      const oldList = (change.oldValue as string[]) ?? [];
      const newList = (change.newValue as string[]) ?? [];
      const added = newList.filter((f: string) => !oldList.includes(f));
      const removed = oldList.filter((f: string) => !newList.includes(f));
      if (added.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Enabling masked teaser for: ${added.join(", ")}`,
        });
      }
      if (removed.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Removing masked teaser for: ${removed.join(", ")} — these fields will be fully hidden`,
        });
      }
    }

    if (change.key === "visibility.masking_rules") {
      const oldRules = (change.oldValue as Record<string, unknown>) ?? {};
      const newRules = (change.newValue as Record<string, unknown>) ?? {};
      const allFields = new Set([...Object.keys(oldRules), ...Object.keys(newRules)]);
      const changedFields: string[] = [];
      for (const field of allFields) {
        if (JSON.stringify(oldRules[field]) !== JSON.stringify(newRules[field])) {
          changedFields.push(field);
        }
      }
      if (changedFields.length > 0) {
        impacts.push({
          category: "visibility",
          description: `Masking rules changed for: ${changedFields.join(", ")}`,
        });
      }
    }

    // Circle cutover impact
    if (change.key === "integration.circle_cutover_enabled") {
      const newVal = change.newValue as boolean;
      impacts.push({
        category: "integrations",
        description: newVal
          ? "⚠️ Circle headless cutover ENABLED — auth flow will switch to Supabase-issued headless tokens"
          : "Circle headless cutover disabled — reverting to legacy Circle auth",
      });
    }

    if (change.key === "integration.circle_canary_org_ids") {
      const newList = (change.newValue as string[]) ?? [];
      impacts.push({
        category: "integrations",
        description: `Circle cutover canary list: ${newList.length} organization(s) in rollout`,
      });
    }

    if (change.key === "integration.circle_legacy_fallback_enabled") {
      const newVal = change.newValue as boolean;
      impacts.push({
        category: "integrations",
        description: newVal
          ? "Legacy Circle fallback path enabled — safe rollback available during cutover"
          : "⚠️ Legacy Circle fallback DISABLED — no rollback path if cutover encounters issues",
      });
    }

    if (change.key === "integration.conference_ops_masthead_org_ids") {
      const oldList = (change.oldValue as string[]) ?? [];
      const newList = (change.newValue as string[]) ?? [];
      const added = newList.filter((orgId) => !oldList.includes(orgId));
      const removed = oldList.filter((orgId) => !newList.includes(orgId));
      if (added.length > 0) {
        impacts.push({
          category: "integrations",
          description: `Masthead ops access granted to org IDs: ${added.join(", ")}`,
        });
      }
      if (removed.length > 0) {
        impacts.push({
          category: "integrations",
          description: `Masthead ops access revoked from org IDs: ${removed.join(", ")}`,
        });
      }
    }

    // Scheduling impact
    if (change.key === "conference.swap_cap") {
      impacts.push({
        category: "scheduling",
        description: `Swap cap: ${change.oldValue} → ${change.newValue} per delegate`,
      });
    }

    // Admin transfer impact
    if (change.key === "admin_transfer.timeout_duration") {
      impacts.push({
        category: "admin",
        description: `Admin transfer timeout: ${change.oldValue} → ${change.newValue}`,
      });
    }

    if (change.key === "retention.travel_delete_rule") {
      impacts.push({
        category: "retention",
        description: `Retention rule changed: ${change.oldValue} → ${change.newValue}. This affects automated travel-data purge cutoff behavior.`,
      });
    }

    if (change.key === "consent.travel_data_required") {
      const enabled = Boolean(change.newValue);
      impacts.push({
        category: "retention",
        description: enabled
          ? "Travel consent gate will be required before travel fields can be collected."
          : "Travel consent gate will be disabled; travel fields can be captured without explicit consent.",
      });
    }

    if (change.key === "consent.dietary_accessibility_required") {
      const enabled = Boolean(change.newValue);
      impacts.push({
        category: "retention",
        description: enabled
          ? "Dietary/accessibility consent gate will be required in registration."
          : "Dietary/accessibility consent gate remains optional.",
      });
    }

    // Generic fallback for changes without specific impact logic
    const impactCountBefore = impacts.length;
    if (impactCountBefore === 0 || !impacts.some((i) => i.description.includes(change.key))) {
      // Only add generic if no specific impact was already added for this key
      const hasSpecific = impacts.some(
        (i) =>
          (change.key.includes("billing") && i.category === "billing") ||
          (change.key.includes("renewal") && i.category === "renewals") ||
          (change.key.includes("visibility") && i.category === "visibility") ||
          (change.key.includes("conference") && i.category === "scheduling") ||
          (change.key.includes("admin_transfer") && i.category === "admin") ||
          (change.key.includes("integration") && i.category === "integrations")
      );
      if (!hasSpecific) {
        impacts.push({
          category: change.category,
          description: `${change.label}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`,
        });
      }
    }
  }

  return { success: true, data: { changes, impacts } };
}

// ─────────────────────────────────────────────────────────────────
// Publish & Rollback
// ─────────────────────────────────────────────────────────────────

/** Publish a draft (super_admin only). Uses atomic RPC. */
export async function publishDraft(
  policySetId: string,
  effectiveAt: string | null,
  confirmations: Record<string, string>
): Promise<{ success: boolean; error?: string; data?: PolicySet }> {
  const auth = await verifySuperAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  // Validate draft first
  const validationResult = await validateDraft(policySetId);
  if (!validationResult.success || !validationResult.data?.valid) {
    const errorDetails = validationResult.data?.errors
      ?.map((e) => `${e.label}: ${e.message}`)
      .join("; ");
    await logPolicyAudit({
      action: "policy_draft_publish",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "validation_failed", error: errorDetails ?? null },
    });
    return {
      success: false,
      error: `Draft has validation errors: ${errorDetails}`,
    };
  }

  // Check high-risk confirmations
  const { data: highRiskValues } = await supabase
    .from("policy_values")
    .select("key, label")
    .eq("policy_set_id", policySetId)
    .eq("is_high_risk", true);

  // Get the active set to compare — only require confirmation for changed high-risk values
  const { data: activeSet } = await supabase
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .single();

  if (activeSet && highRiskValues) {
    const diffResult = await getPolicyDiff(activeSet.id, policySetId);
    const changedHighRiskKeys = new Set(
      (diffResult.data ?? [])
        .filter((d) => d.isHighRisk)
        .map((d) => d.key)
    );

    for (const hrv of highRiskValues) {
      if (changedHighRiskKeys.has(hrv.key)) {
        if (confirmations[hrv.key] !== "CONFIRM") {
          await logPolicyAudit({
            action: "policy_draft_publish",
            actorId: auth.userId,
            entityId: policySetId,
            success: false,
            details: {
              reason: "high_risk_confirmation_missing",
              key: hrv.key,
            },
          });
          return {
            success: false,
            error: `High-risk key "${hrv.label}" requires typed confirmation`,
          };
        }
      }
    }
  }

  // Call atomic RPC (cast needed — RPC not in generated types until next regen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResult, error: rpcError } = await (supabase.rpc as any)(
    "publish_policy_draft",
    {
      p_draft_set_id: policySetId,
      p_effective_at: effectiveAt,
      p_user_id: auth.userId!,
    }
  );

  if (rpcError) {
    await logPolicyAudit({
      action: "policy_draft_publish",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "rpc_failed", error: rpcError.message },
    });
    return { success: false, error: rpcError.message };
  }

  const result = rpcResult as { success: boolean; error?: string };
  if (!result.success) {
    await logPolicyAudit({
      action: "policy_draft_publish",
      actorId: auth.userId,
      entityId: policySetId,
      success: false,
      details: { reason: "publish_rejected", error: result.error ?? null },
    });
    return { success: false, error: result.error };
  }

  clearPolicyCache();

  // Re-fetch the published set
  const { data: publishedSet } = await supabase
    .from("policy_sets")
    .select("*")
    .eq("id", policySetId)
    .single();

  await logPolicyAudit({
    action: "policy_draft_publish",
    actorId: auth.userId,
    entityId: policySetId,
    success: true,
    details: { effectiveAt },
  });
  return { success: true, data: publishedSet as PolicySet };
}

/** Rollback to a previous version (super_admin only). Uses atomic RPC. */
export async function rollbackToVersion(
  targetSetId: string,
  reason: string
): Promise<{ success: boolean; error?: string; data?: PolicySet }> {
  const auth = await verifySuperAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResult, error: rpcError } = await (auth.supabase.rpc as any)(
    "rollback_policy_to_version",
    {
      p_target_set_id: targetSetId,
      p_reason: reason,
      p_user_id: auth.userId!,
    }
  );

  if (rpcError) {
    await logPolicyAudit({
      action: "policy_version_rollback",
      actorId: auth.userId,
      entityId: targetSetId,
      success: false,
      details: { reason: "rpc_failed", error: rpcError.message },
    });
    return { success: false, error: rpcError.message };
  }

  const result = rpcResult as {
    success: boolean;
    error?: string;
    new_set_id?: string;
  };
  if (!result.success) {
    await logPolicyAudit({
      action: "policy_version_rollback",
      actorId: auth.userId,
      entityId: targetSetId,
      success: false,
      details: { reason: "rollback_rejected", error: result.error ?? null },
    });
    return { success: false, error: result.error };
  }

  clearPolicyCache();

  // Fetch the new active set
  const { data: newSet } = await auth.supabase
    .from("policy_sets")
    .select("*")
    .eq("id", result.new_set_id!)
    .single();

  await logPolicyAudit({
    action: "policy_version_rollback",
    actorId: auth.userId,
    entityId: result.new_set_id ?? targetSetId,
    success: true,
    details: { targetSetId, reason },
  });
  return { success: true, data: newSet as PolicySet };
}

// ─────────────────────────────────────────────────────────────────
// Version History
// ─────────────────────────────────────────────────────────────────

/** Get all published policy sets, ordered by published_at desc. */
export async function getPolicyVersionHistory(): Promise<{
  success: boolean;
  error?: string;
  data?: PolicySet[];
}> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from("policy_sets")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as PolicySet[] };
}

/** Get the current active set + any draft. Used by the dashboard page. */
export async function getPolicyDashboardData(): Promise<{
  success: boolean;
  error?: string;
  data?: {
    activeSet: PolicySet | null;
    draft: PolicySet | null;
    activeValues: PolicyValue[];
    draftValues: PolicyValue[];
  };
}> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const supabase = auth.supabase;

  const [
    { data: activeSet, error: activeSetError },
    { data: draft, error: draftError },
  ] = await Promise.all([
    supabase
      .from("policy_sets")
      .select("*")
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("policy_sets")
      .select("*")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (activeSetError) {
    return {
      success: false,
      error: `Failed to load active policy set: ${activeSetError.message}`,
    };
  }

  if (draftError) {
    return {
      success: false,
      error: `Failed to load draft policy set: ${draftError.message}`,
    };
  }

  // Fetch values for whichever sets exist
  const activeValues: PolicyValue[] = [];
  const draftValues: PolicyValue[] = [];

  if (activeSet) {
    const { data, error } = await supabase
      .from("policy_values")
      .select("*")
      .eq("policy_set_id", activeSet.id)
      .order("category")
      .order("display_order");
    if (error) {
      return {
        success: false,
        error: `Failed to load active policy values: ${error.message}`,
      };
    }
    if (data) activeValues.push(...(data as PolicyValue[]));
  }

  if (draft) {
    const integrationSeed = await ensureRequiredIntegrationPolicies(supabase, draft.id);
    if (!integrationSeed.success) {
      return {
        success: false,
        error: integrationSeed.error,
      };
    }

    const { data, error } = await supabase
      .from("policy_values")
      .select("*")
      .eq("policy_set_id", draft.id)
      .order("category")
      .order("display_order");
    if (error) {
      return {
        success: false,
        error: `Failed to load draft policy values: ${error.message}`,
      };
    }
    if (data) draftValues.push(...(data as PolicyValue[]));
  }

  return {
    success: true,
    data: {
      activeSet: activeSet as PolicySet | null,
      draft: draft as PolicySet | null,
      activeValues,
      draftValues,
    },
  };
}
