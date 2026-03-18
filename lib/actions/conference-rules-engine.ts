"use server";

import { isSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emptyRulesEngine,
  normalizeRulesEngine,
  type RulesEngineV1,
} from "@/lib/conference/rules-engine";

export async function getConferenceRulesEngine(
  conferenceId: string
): Promise<{ success: true; data: RulesEngineV1 } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_schedule_modules")
    .select("config_json")
    .eq("conference_id", conferenceId)
    .eq("module_key", "registration_ops")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  const config =
    data?.config_json && typeof data.config_json === "object" && !Array.isArray(data.config_json)
      ? (data.config_json as Record<string, unknown>)
      : {};
  const engine = normalizeRulesEngine(config.rules_engine_v1 ?? emptyRulesEngine());
  return { success: true, data: engine };
}

export async function saveConferenceRulesEngine(params: {
  conferenceId: string;
  engine: RulesEngineV1;
}): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: existing, error: fetchError } = await adminClient
    .from("conference_schedule_modules")
    .select("id, enabled, config_json")
    .eq("conference_id", params.conferenceId)
    .eq("module_key", "registration_ops")
    .maybeSingle();

  if (fetchError) return { success: false, error: fetchError.message };

  const existingConfig =
    existing?.config_json &&
    typeof existing.config_json === "object" &&
    !Array.isArray(existing.config_json)
      ? (existing.config_json as Record<string, unknown>)
      : {};
  const nextConfig: Json = {
    ...existingConfig,
    rules_engine_v1: {
      ...normalizeRulesEngine(params.engine),
      updated_at: new Date().toISOString(),
    },
  };

  if (existing?.id) {
    const { error } = await adminClient
      .from("conference_schedule_modules")
      .update({
        config_json: nextConfig,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  const { error: insertError } = await adminClient.from("conference_schedule_modules").insert({
    conference_id: params.conferenceId,
    module_key: "registration_ops",
    enabled: true,
    config_json: nextConfig,
  });
  if (insertError) return { success: false, error: insertError.message };

  return { success: true };
}

type RulesBuilderContext = {
  organizationTypes: string[];
  membershipStatuses: string[];
};

const DEFAULT_MEMBERSHIP_STATUSES = [
  "applied",
  "approved",
  "active",
  "grace",
  "locked",
  "reactivated",
  "canceled",
];

export async function getConferenceRulesBuilderContext(
  conferenceId: string
): Promise<{ success: true; data: RulesBuilderContext } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("id")
    .eq("id", conferenceId)
    .maybeSingle();

  if (conferenceError) return { success: false, error: conferenceError.message };

  const fetchOrganizationsByTenantIds = async (tenantIds: string[]) => {
    if (tenantIds.length === 0) return { data: [] as Array<{ type: string | null; membership_status: string | null }>, error: null as { message: string } | null };
    const { data, error } = await adminClient
      .from("organizations")
      .select("type, membership_status")
      .in("tenant_id", tenantIds)
      .is("archived_at", null);
    return { data: data ?? [], error: error ? { message: error.message } : null };
  };

  let orgRows: Array<{ type: string | null; membership_status: string | null }> = [];

  if (isSuperAdmin(auth.ctx.globalRole)) {
    const { data, error } = await adminClient
      .from("organizations")
      .select("type, membership_status")
      .is("archived_at", null);
    if (error) return { success: false, error: error.message };
    orgRows = data ?? [];
  } else if (auth.ctx.activeOrgIds.length > 0) {
    const { data: scopedOrgRows, error: scopedOrgError } = await adminClient
      .from("organizations")
      .select("tenant_id")
      .in("id", auth.ctx.activeOrgIds)
      .is("archived_at", null);

    if (scopedOrgError) return { success: false, error: scopedOrgError.message };

    const tenantIds = Array.from(
      new Set(
        (scopedOrgRows ?? [])
          .map((row) => row.tenant_id)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      )
    );

    const tenantScoped = await fetchOrganizationsByTenantIds(tenantIds);
    if (tenantScoped.error) return { success: false, error: tenantScoped.error.message };
    orgRows = tenantScoped.data;
  }

  const organizationTypes = Array.from(
    new Set(
      (orgRows ?? [])
        .map((row) => row.type)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const membershipStatusValues = (orgRows ?? [])
    .map((row) => row.membership_status)
    .filter((value): value is NonNullable<(typeof orgRows)[number]["membership_status"]> => value !== null)
    .map((value) => String(value))
    .filter((value) => value.trim().length > 0);

  const membershipStatuses = Array.from(
    new Set([...DEFAULT_MEMBERSHIP_STATUSES, ...membershipStatusValues])
  ).sort((a, b) => a.localeCompare(b));

  return {
    success: true,
    data: {
      organizationTypes,
      membershipStatuses,
    },
  };
}
