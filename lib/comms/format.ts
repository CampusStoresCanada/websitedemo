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
 * A single date, written the way a person would write it.
 *
 * Exists because `renewal_date` was being passed straight through as
 * "2026-09-01" and rendering that way in every renewal reminder the membership
 * receives. A stored date is not a written date, and the gap between them is
 * invisible in code and obvious in an inbox.
 *
 * UTC throughout: these are calendar dates (a renewal date, a deadline), not
 * moments, and reading them in the server's timezone is how a September 1st
 * becomes an August 31st.
 */
export function formatMemberFacingDate(date: string | null | undefined): string {
  if (!date) return "";
  const iso = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return date;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
