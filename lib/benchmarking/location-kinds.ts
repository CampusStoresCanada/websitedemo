/**
 * What kind of place a store location is.
 *
 * ⛔ Lives here, NOT in lib/actions/benchmarking-locations.ts. That file is
 * "use server", and a "use server" module may only export async functions —
 * exporting this array from it type-checks, passes every test, and then breaks
 * the whole module at runtime with "A 'use server' file can only export async
 * functions, found object". The survey page 500s and nothing else tells you.
 * `export type` is fine there (erased at compile); a const is not.
 *
 * ── Why there is no "Satellite" ──────────────────────────────────────────
 *
 * It was in the first version and it does not belong beside these. Permanent
 * and Seasonal answer WHEN a location is open. Satellite answers what it is
 * RELATIVE TO the main store — a different axis — so a year-round shop on a
 * second campus is both, and one list forces that store to pick one fact and
 * discard the other.
 *
 * "Which of these is not the main store" is also already implied by there being
 * more than one. If main-versus-secondary turns out to matter, it is one flag
 * on one location, not a category on all of them.
 *
 * A seasonal pop-up and a permanent main store still carry very different
 * square footage for the same sales, which is the distinction worth keeping:
 * a per-square-foot comparison that cannot tell them apart compares the wrong
 * things.
 */
export type LocationKind = "Permanent" | "Seasonal" | "Other";

export const LOCATION_KINDS: {
  value: LocationKind;
  label: string;
  help: string;
}[] = [
  {
    value: "Permanent",
    label: "Permanent",
    help: "Open year-round, or on the same schedule as the campus it serves. Your main store is almost always this.",
  },
  {
    value: "Seasonal",
    label: "Seasonal",
    help: "Open for part of the year only — a rush shop, a convocation pop-up, a location you close between terms.",
  },
  {
    value: "Other",
    label: "Other",
    help: "Anything that is neither, including space you share with someone else or operate on an unusual schedule.",
  },
];
