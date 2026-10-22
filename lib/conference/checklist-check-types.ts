// The fixed, developer-maintained vocabulary of "is this done" checks a
// checklist task can use. Deliberately its own file, with zero server-only
// imports (no supabase/admin) — it needs to be safely importable from
// client components (the task-authoring form), not just the server-side
// evaluation engine. The DB's check_type CHECK constraint (see migration)
// and this list must be kept in sync.
export const CHECK_TYPES = [
  "seat_assigned",
  "entity_purchased",
  "travel_info_submitted",
  "payment_complete",
  "legal_document_accepted",
  "directory_profile_complete",
  "self_reported",
  "directory_profile_enriched",
  "top_choices_declared",
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/**
 * Who answers a task. "Org admins answer for the company, people answer for
 * themselves." The reminder engine processes `org` tasks only — it is
 * org-scoped throughout — while `person` tasks render on /me/conference.
 */
export const TASK_AUDIENCES = ["org", "person", "staff"] as const;
export type TaskAudience = (typeof TASK_AUDIENCES)[number];

/**
 * What CSC staff answer for the conference itself — the War Room's checklists.
 *
 * A separate vocabulary, not more entries in CHECK_TYPES: those are answered
 * by a company (or a person), and every one of them takes an organization.
 * These read conference-wide facts — is the badge package current, is the
 * print station online — and an org-shaped check would have no org to ask.
 *
 * Staff tasks may also be `self_reported`: a plain tick, kept as an ordinary
 * acknowledgement filed under CSC's own organization.
 *
 * Keep in sync with the check_type CHECK constraint
 * (20261022180000_staff_checklist_audience).
 */
export const STAFF_CHECK_TYPES = [
  "badge_package_current",
  "schedule_promoted",
  "print_station_online",
  "test_check_ins_cleared",
  "check_in_cards_printed",
  "door_lists_printed",
  "directory_printed",
  "map_printed",
  "attendee_list_printed",
] as const;
export type StaffCheckType = (typeof STAFF_CHECK_TYPES)[number];

/** What a staff task may use: its own checks, or a plain tick. */
export const STAFF_TASK_CHECK_TYPES = [...STAFF_CHECK_TYPES, "self_reported"] as const;
export type StaffTaskCheckType = (typeof STAFF_TASK_CHECK_TYPES)[number];

export function isStaffCheckType(value: string): value is StaffCheckType {
  return (STAFF_CHECK_TYPES as readonly string[]).includes(value);
}
