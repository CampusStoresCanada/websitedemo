// The fixed, developer-maintained vocabulary of "is this done" checks a
// checklist task can use. Deliberately its own file, with zero server-only
// imports (no supabase/admin) — it needs to be safely importable from
// client components (the task-authoring form), not just the server-side
// evaluation engine. The DB's check_type CHECK constraint (see migration)
// and this list must be kept in sync.
export const CHECK_TYPES = ["seat_assigned", "entity_purchased", "travel_info_submitted", "payment_complete"] as const;
export type CheckType = (typeof CHECK_TYPES)[number];
