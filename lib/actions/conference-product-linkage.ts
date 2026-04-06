"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConferenceScheduleModuleKey, ConferenceScheduleModuleRow } from "@/lib/actions/conference-schedule-design";
import {
  getPurchaseRequiredModuleKeysFromRegistrationConfig,
  normalizeModuleConfig,
} from "@/lib/conference/schedule-setup-model";

type RegistrationOptionRow = {
  id: string;
  name: string;
  registration_type?: string;
  linked_product_ids?: string[];
};

const MODULE_ACCESS_KEYS: ConferenceScheduleModuleKey[] = [
  "meetings",
  "trade_show",
  "education",
  "meals",
  "travel_accommodation",
];

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export async function updateProductLinkages(params: {
  conferenceId: string;
  productId: string;
  moduleAccessKeys: ConferenceScheduleModuleKey[];
  registrationOptionIds: string[];
  standaloneAllowed: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  data?: {
    modules: ConferenceScheduleModuleRow[];
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: existingRows, error: fetchError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", params.conferenceId);

  if (fetchError) return { success: false, error: fetchError.message };
  const rows = (existingRows ?? []) as ConferenceScheduleModuleRow[];
  const rowByKey = new Map(rows.map((row) => [row.module_key, row]));

  const registrationOpsRow = rowByKey.get("registration_ops");
  const registrationConfig = ((registrationOpsRow?.config_json ?? {}) as Record<string, unknown>) ?? {};
  const purchaseRequiredKeys = getPurchaseRequiredModuleKeysFromRegistrationConfig(registrationConfig);
  const normalizedModuleKeys = params.moduleAccessKeys.filter(
    (key) => MODULE_ACCESS_KEYS.includes(key) && purchaseRequiredKeys.has(key as never)
  );
  const moduleKeySet = new Set(normalizedModuleKeys);

  const moduleUpserts = MODULE_ACCESS_KEYS.map((key) => {
    const row = rowByKey.get(key);
    const currentConfig = ((row?.config_json ?? {}) as Record<string, unknown>) ?? {};
    const nextConfig = { ...currentConfig };
    if (moduleKeySet.has(key)) {
      nextConfig.access_product_id = params.productId;
    } else if (nextConfig.access_product_id === params.productId) {
      delete nextConfig.access_product_id;
    }
    return {
      conference_id: params.conferenceId,
      module_key: key,
      enabled: row?.enabled ?? false,
      config_json: normalizeModuleConfig(key, nextConfig) as unknown as import("@/lib/database.types").Json,
      updated_at: new Date().toISOString(),
      created_by: auth.ctx.userId,
    };
  });

  if (registrationOpsRow) {
    const regConfig = registrationConfig;
    const selectedIds = new Set(uniqueStrings(params.registrationOptionIds));
    const options = Array.isArray(regConfig.registration_options)
      ? (regConfig.registration_options as Array<Record<string, unknown>>)
      : [];
    const nextOptions = options.map((option) => {
      const optionId = typeof option.id === "string" ? option.id : "";
      if (!optionId) return option;
      const linked = Array.isArray(option.linked_product_ids)
        ? uniqueStrings(
            option.linked_product_ids.filter((entry): entry is string => typeof entry === "string")
          )
        : [];
      const linkedSet = new Set(linked);
      if (selectedIds.has(optionId)) linkedSet.add(params.productId);
      else linkedSet.delete(params.productId);
      return {
        ...option,
        linked_product_ids: [...linkedSet],
      };
    });

    moduleUpserts.push({
      conference_id: params.conferenceId,
      module_key: "registration_ops",
      enabled: registrationOpsRow.enabled,
      config_json: normalizeModuleConfig("registration_ops", {
        ...regConfig,
        registration_options: nextOptions as RegistrationOptionRow[],
      }) as unknown as import("@/lib/database.types").Json,
      updated_at: new Date().toISOString(),
      created_by: auth.ctx.userId,
    });
  }

  const { error: upsertError } = await adminClient
    .from("conference_schedule_modules")
    .upsert(moduleUpserts, { onConflict: "conference_id,module_key" });
  if (upsertError) return { success: false, error: upsertError.message };

  const { data: product, error: productFetchError } = await adminClient
    .from("conference_products")
    .select("id, metadata")
    .eq("id", params.productId)
    .maybeSingle();
  if (productFetchError) return { success: false, error: productFetchError.message };

  if (product) {
    const currentMetadata =
      product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
        ? { ...(product.metadata as Record<string, unknown>) }
        : {};
    currentMetadata.standalone_allowed = params.standaloneAllowed;
    const { error: productUpdateError } = await adminClient
      .from("conference_products")
      .update({
        metadata: currentMetadata as unknown as import("@/lib/database.types").Json,
      })
      .eq("id", params.productId);
    if (productUpdateError) return { success: false, error: productUpdateError.message };
  }

  const { data: finalRows, error: finalError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", params.conferenceId);
  if (finalError) return { success: false, error: finalError.message };

  return {
    success: true,
    data: {
      modules: (finalRows ?? []) as ConferenceScheduleModuleRow[],
    },
  };
}
