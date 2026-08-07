// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Condition Evaluation (server-only)
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveConditionSubjectRow, type ConditionRecipient } from "./resolve";
import type { ConditionOperator, ConditionSubjectKey } from "./registry";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface CommsCondition {
  id: string;
  key: string;
  label: string;
  subject: ConditionSubjectKey;
  reference_id: string | null;
  field: string;
  operator: ConditionOperator;
  value: string | null;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function evaluateOperator(value: unknown, operator: ConditionOperator, compareValue: string | null): boolean {
  switch (operator) {
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
    case "equals":
      return String(value ?? "") === String(compareValue ?? "");
    case "not_equals":
      return String(value ?? "") !== String(compareValue ?? "");
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(compareValue ?? "").toLowerCase());
    case "before":
      return !isEmptyValue(value) && !!compareValue && new Date(value as string) < new Date(compareValue);
    case "after":
      return !isEmptyValue(value) && !!compareValue && new Date(value as string) > new Date(compareValue);
    case "is_true":
      return value === true;
    case "is_false":
      return value === false;
    default:
      return false;
  }
}

/**
 * Evaluate one saved condition against one recipient. False (not an
 * error) whenever the subject can't be resolved — e.g. the recipient
 * has no org membership, so an organization-subject condition reads as
 * false rather than blowing up the whole send.
 */
export async function evaluateCondition(
  supabase: AdminClient,
  condition: CommsCondition,
  recipient: ConditionRecipient
): Promise<boolean> {
  const row = await resolveConditionSubjectRow(supabase, condition.subject, recipient, condition.reference_id);
  if (!row) return false;
  return evaluateOperator(row[condition.field], condition.operator, condition.value);
}

/**
 * Evaluate every given condition against one recipient, keyed by
 * condition.key — the same keys used in {{#if key}} blocks.
 */
export async function evaluateConditionsForRecipient(
  supabase: AdminClient,
  conditions: CommsCondition[],
  recipient: ConditionRecipient
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    conditions.map(async (c) => [c.key, await evaluateCondition(supabase, c, recipient)] as const)
  );
  return Object.fromEntries(entries);
}
