// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Saved Conditions CRUD
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { ConditionOperator, ConditionSubjectKey } from "./registry";
import type { CommsCondition } from "./evaluate";

/** Extracts the keys referenced by {{#if key}} blocks in a template string. */
export function extractConditionKeys(template: string): string[] {
  const keys = new Set<string>();
  const re = /\{\{#if\s+([a-zA-Z0-9_-]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    keys.add(match[1]);
  }
  return [...keys];
}

export async function listConditions(): Promise<CommsCondition[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("comms_conditions").select("*").order("label");
  if (error) {
    console.error("[comms/conditions] listConditions error:", error);
    return [];
  }
  return (data ?? []) as CommsCondition[];
}

export async function getConditionsByKeys(keys: string[]): Promise<CommsCondition[]> {
  if (keys.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("comms_conditions").select("*").in("key", keys);
  if (error) {
    console.error("[comms/conditions] getConditionsByKeys error:", error);
    return [];
  }
  return (data ?? []) as CommsCondition[];
}

export async function createCondition(data: {
  label: string;
  subject: ConditionSubjectKey;
  referenceId?: string;
  field: string;
  operator: ConditionOperator;
  value?: string;
  createdBy?: string;
}): Promise<{ success: boolean; id?: string; key?: string; error?: string }> {
  const supabase = createAdminClient();
  const key = `cond_${crypto.randomUUID().replace(/-/g, "")}`;

  const { data: row, error } = await supabase
    .from("comms_conditions")
    .insert({
      key,
      label: data.label,
      subject: data.subject,
      reference_id: data.referenceId ?? null,
      field: data.field,
      operator: data.operator,
      value: data.value ?? null,
      created_by: data.createdBy ?? null,
    })
    .select("id, key")
    .single();

  if (error || !row) return { success: false, error: error?.message ?? "Insert failed" };
  return { success: true, id: row.id, key: row.key };
}
