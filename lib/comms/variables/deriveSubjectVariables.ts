// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Subject Fields → Variables
// Every field the condition system knows how to check (CONDITION_SUBJECTS)
// is also available as a {{subject_field}} variable — one catalog, two
// uses, so "what can I check" and "what can I insert" never drift apart
// the way the old hand-picked variable list could.
// ─────────────────────────────────────────────────────────────────

import { CONDITION_SUBJECTS, type ConditionSubjectKey } from "../conditions/registry";

function formatFieldValue(value: unknown, type: string): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date") {
    const d = new Date(value as string);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
  }
  if (type === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Maps a resolved subject row (e.g. an organizations row) into
 * {organization_logo_url: "...", organization_membership_status: "...", ...}
 * — every field declared for that subject in CONDITION_SUBJECTS, skipping
 * ones with no value so a template never renders a literal empty string
 * where a variable was expected to have content.
 */
export function deriveSubjectVariables(
  subject: ConditionSubjectKey,
  row: Record<string, unknown> | null
): Record<string, string> {
  if (!row) return {};
  const fields = CONDITION_SUBJECTS[subject].fields;
  const result: Record<string, string> = {};

  for (const [fieldKey, fieldDef] of Object.entries(fields)) {
    const formatted = formatFieldValue(row[fieldKey], fieldDef.type);
    if (formatted) result[`${subject}_${fieldKey}`] = formatted;
  }

  return result;
}
