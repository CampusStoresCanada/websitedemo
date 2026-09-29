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
 * A seasonal pop-up and a permanent main store carry very different square
 * footage for the same sales, so a per-square-foot comparison that cannot tell
 * them apart is comparing the wrong things.
 */
export type LocationKind = "Permanent" | "Seasonal" | "Satellite" | "Other";

export const LOCATION_KINDS: LocationKind[] = [
  "Permanent",
  "Seasonal",
  "Satellite",
  "Other",
];
