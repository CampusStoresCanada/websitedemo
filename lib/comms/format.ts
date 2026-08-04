// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Shared Variable-Value Formatting
// ─────────────────────────────────────────────────────────────────

import type { SystemVariableKey } from "./variables/registry";

export function formatConferenceDates(startDate: string | null, endDate: string | null): string {
  if (!startDate) return "";
  const start = new Date(`${startDate}T00:00:00Z`);
  const startLabel = start.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  if (!endDate || endDate === startDate) {
    return `${startLabel}, ${start.getUTCFullYear()}`;
  }
  const end = new Date(`${endDate}T00:00:00Z`);
  const endLabel = end.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${startLabel} – ${endLabel}, ${end.getUTCFullYear()}`;
}

/**
 * Baseline {{recipient_name}}/{{first_name}}/{{email}} for any resolved
 * recipient — falls back to the email's local part when there's no real
 * name on file, so the template never renders a literal empty string.
 */
export function deriveRecipientNameVariables(
  name: string | null,
  email: string
): Pick<Record<SystemVariableKey, string>, "recipient_name" | "first_name" | "email"> {
  const displayName = name?.trim() || email.split("@")[0] || email;
  const firstName = displayName.split(/\s+/)[0] || displayName;
  return {
    recipient_name: displayName,
    first_name: firstName,
    email,
  };
}
