// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Condition Evaluation (server-only)
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveConditionSubjectRows, type ConditionRecipient } from "./resolve";
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
 * Evaluate every given condition against every given recipient. Each
 * condition's subject is resolved once for the whole recipient group
 * (see resolveConditionSubjectRows) instead of once per recipient, so
 * this scales to hundreds of recipients as a handful of batched queries
 * rather than a Promise.all of hundreds of individual ones.
 *
 * Returns one flags object per recipient, in the same order as the
 * input array — keyed by condition.key, the same keys used in
 * {{#if key}} blocks. A recipient with no userId, or whose subject
 * can't be resolved for a given condition, reads as false for that
 * condition rather than erroring.
 */
export async function evaluateConditionsBatch(
  supabase: AdminClient,
  conditions: CommsCondition[],
  recipients: ConditionRecipient[]
): Promise<Record<string, boolean>[]> {
  if (conditions.length === 0) return recipients.map(() => ({}));

  const perCondition = await Promise.all(
    conditions.map(async (condition) => ({
      condition,
      rows: await resolveConditionSubjectRows(supabase, condition.subject, recipients, condition.reference_id),
    }))
  );

  return recipients.map((recipient) => {
    const flags: Record<string, boolean> = {};
    for (const { condition, rows } of perCondition) {
      const row = recipient.userId ? rows.get(recipient.userId) : undefined;
      flags[condition.key] = row ? evaluateOperator(row[condition.field], condition.operator, condition.value) : false;
    }
    return flags;
  });
}
