"use server";

import { requireSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";

// Tables not yet in generated types — use untyped accessor.
// Regenerate types after migration is applied to remove these casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromTable(supabase: ReturnType<typeof createAdminClient>, table: string) {
  return (supabase as any).from(table);
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface PlatformConfig {
  id: string;
  client_name: string;
  client_short_name: string;
  client_domain: string;
  support_email: string;
  logo_url: string | null;
  primary_color: string;
  bootstrapped_at: string | null;
  bootstrapped_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformFeature {
  id: string;
  feature_key: string;
  enabled: boolean;
  always_on: boolean;
  config_json: Record<string, unknown>;
  enabled_at: string | null;
  enabled_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PLATFORM_FEATURE_KEYS = [
  "membership",
  "billing",
  "visibility",
  "calendar",
  "conference",
  "circle",
  "quickbooks",
  "communications",
  "events",
] as const;

export type PlatformFeatureKey = (typeof PLATFORM_FEATURE_KEYS)[number];

export const PLATFORM_FEATURE_LABELS: Record<PlatformFeatureKey, string> = {
  membership: "Membership & Partnerships",
  billing: "Billing & Invoicing",
  visibility: "Data Visibility",
  calendar: "Calendar & Timeline",
  conference: "Conference Management",
  circle: "Community (Circle)",
  quickbooks: "QuickBooks Integration",
  communications: "Email Communications",
  events: "Events (Non-Conference)",
};

export const PLATFORM_FEATURE_DESCRIPTIONS: Record<PlatformFeatureKey, string> = {
  membership:
    "Core membership state machine, renewals, and partner lifecycle management.",
  billing:
    "Stripe-based invoicing, payment processing, and proration rules.",
  visibility:
    "Field-level access control, masking rules, and public/private allowlists.",
  calendar:
    "Operational timeline engine powering renewal cycles, billing schedules, and deadline tracking.",
  conference:
    "Full conference lifecycle: registration, scheduling, swaps, commerce, badges, and travel ops.",
  circle:
    "Community platform integration with Circle for SSO, member sync, and access groups.",
  quickbooks:
    "Invoice export and payment reconciliation with QuickBooks Online.",
  communications:
    "Email campaign management with audience targeting and delivery tracking via Resend.",
  events:
    "Non-conference event management with ticketing, approvals, and member submissions.",
};

/** Maps feature keys to the policy categories they scope */
export const FEATURE_POLICY_CATEGORIES: Record<PlatformFeatureKey, string[]> = {
  membership: ["renewals", "admin"],
  billing: ["billing"],
  visibility: ["visibility"],
  calendar: [],
  conference: ["scheduling"],
  circle: ["integrations"],
  quickbooks: [],
  communications: [],
  events: [],
};

// ─────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────

export async function getPlatformConfig(): Promise<{
  success: boolean;
  data?: PlatformConfig | null;
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();
  const { data, error } = await fromTable(supabase, "platform_config")
    .select("*")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as PlatformConfig | null };
}

export async function getPlatformFeatures(): Promise<{
  success: boolean;
  data?: PlatformFeature[];
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();
  const { data, error } = await fromTable(supabase, "platform_features")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as PlatformFeature[] };
}

export async function isBootstrapped(): Promise<boolean> {
  const auth = await requireAdmin();
  if (!auth.ok) return false;

  const supabase = createAdminClient();
  const { data } = await fromTable(supabase, "platform_config")
    .select("bootstrapped_at")
    .maybeSingle();

  return !!data?.bootstrapped_at;
}

// ─────────────────────────────────────────────────────────────────
// Write operations (super_admin only)
// ─────────────────────────────────────────────────────────────────

export async function savePlatformIdentity(input: {
  client_name: string;
  client_short_name: string;
  client_domain: string;
  support_email: string;
  logo_url?: string | null;
  primary_color: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();

  // Upsert singleton row
  const { data: existing } = await fromTable(supabase, "platform_config")
    .select("id")
    .maybeSingle();

  const payload = {
    client_name: input.client_name.trim(),
    client_short_name: input.client_short_name.trim(),
    client_domain: input.client_domain.trim(),
    support_email: input.support_email.trim(),
    logo_url: input.logo_url ?? null,
    primary_color: input.primary_color.trim(),
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await fromTable(supabase, "platform_config")
      .update(payload)
      .eq("id", existing.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await fromTable(supabase, "platform_config")
      .insert(payload);
    if (error) return { success: false, error: error.message };
  }

  await logAuditEventSafe({
    action: "platform_identity_saved",
    entityType: "platform_config",
    entityId: null,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { client_name: input.client_name },
  });

  return { success: true };
}

export async function updatePlatformFeature(
  featureKey: PlatformFeatureKey,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();

  // Prevent disabling always-on features
  const { data: feature } = await fromTable(supabase, "platform_features")
    .select("always_on")
    .eq("feature_key", featureKey)
    .single();

  if (feature?.always_on && !enabled) {
    return {
      success: false,
      error: `${PLATFORM_FEATURE_LABELS[featureKey]} is a core feature and cannot be disabled.`,
    };
  }

  const now = new Date().toISOString();
  const { error } = await fromTable(supabase, "platform_features")
    .update({
      enabled,
      enabled_at: enabled ? now : null,
      enabled_by: enabled ? auth.ctx.userId : null,
      updated_at: now,
    })
    .eq("feature_key", featureKey);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: enabled ? "platform_feature_enabled" : "platform_feature_disabled",
    entityType: "platform_feature",
    entityId: featureKey,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { feature_key: featureKey, enabled },
  });

  return { success: true };
}

export async function savePlatformFeatures(
  features: Array<{ feature_key: PlatformFeatureKey; enabled: boolean }>
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Fetch always_on flags
  const { data: allFeatures } = await fromTable(supabase, "platform_features")
    .select("feature_key, always_on");
  const alwaysOnKeys = new Set(
    ((allFeatures ?? []) as Array<{ feature_key: string; always_on: boolean }>)
      .filter((f) => f.always_on)
      .map((f) => f.feature_key)
  );

  for (const f of features) {
    // Skip attempts to disable always-on features
    const actualEnabled = alwaysOnKeys.has(f.feature_key) ? true : f.enabled;

    const { error } = await fromTable(supabase, "platform_features")
      .update({
        enabled: actualEnabled,
        enabled_at: actualEnabled ? now : null,
        enabled_by: actualEnabled ? auth.ctx.userId : null,
        updated_at: now,
      })
      .eq("feature_key", f.feature_key);

    if (error) return { success: false, error: error.message };
  }

  await logAuditEventSafe({
    action: "platform_features_bulk_saved",
    entityType: "platform_feature",
    entityId: null,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      features: features.map((f) => ({
        key: f.feature_key,
        enabled: alwaysOnKeys.has(f.feature_key) ? true : f.enabled,
      })),
    },
  });

  return { success: true };
}

export async function completeBootstrap(): Promise<{
  success: boolean;
  error?: string;
}> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Verify platform_config exists
  const { data: config } = await fromTable(supabase, "platform_config")
    .select("id, client_name, bootstrapped_at")
    .maybeSingle();

  if (!config) {
    return {
      success: false,
      error: "Client identity must be configured before completing bootstrap.",
    };
  }

  if (config.bootstrapped_at) {
    return { success: false, error: "Platform is already bootstrapped." };
  }

  if (!config.client_name) {
    return {
      success: false,
      error: "Client name is required before completing bootstrap.",
    };
  }

  // Mark bootstrapped
  const { error } = await fromTable(supabase, "platform_config")
    .update({
      bootstrapped_at: now,
      bootstrapped_by: auth.ctx.userId,
      updated_at: now,
    })
    .eq("id", config.id);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "platform_bootstrap_completed",
    entityType: "platform_config",
    entityId: config.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { client_name: config.client_name },
  });

  return { success: true };
}
