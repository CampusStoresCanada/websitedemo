/**
 * A regional rep's PATCH — a workload, not a peer group.
 *
 * ⛔ Deliberately NOT `REGION_OF` from lib/benchmarking/comparison.ts. That one
 * has five regions because a province is a regulatory jurisdiction: Quebec's
 * two stores are their own comparison group whatever their headcount. A rep's
 * round is a different question, and two stores is not a round, so Quebec
 * rides with Atlantic here.
 *
 * Both answers are correct. The bug was having three copies of this one and
 * letting them disagree:
 *
 *   - the recipients page mapped provinces to the four patches, for display
 *   - RegionAssignment rendered the four patch names
 *   - but the page built the panel's ROWS from the comparison module's five
 *     names, so "Atlantic & Quebec" matched no row
 *
 * The visible result was a patch reporting 0 stores while holding nine, and a
 * rep who could be assigned to it but never shown against it. Assigning worked
 * the whole time, which is what made it look like the assignment was failing
 * rather than the display.
 */

export const PATCHES = [
  "Atlantic & Quebec",
  "Ontario",
  "Prairies",
  "West",
] as const;

export type Patch = (typeof PATCHES)[number];

/** Which provinces make up each patch. Used to assign a whole patch at once. */
export const PATCH_PROVINCES: Record<Patch, string[]> = {
  "Atlantic & Quebec": [
    "Newfoundland and Labrador",
    "Nova Scotia",
    "New Brunswick",
    "Prince Edward Island",
    "Quebec",
  ],
  Ontario: ["Ontario"],
  Prairies: ["Manitoba", "Saskatchewan", "Alberta"],
  West: ["British Columbia", "Yukon", "Northwest Territories", "Nunavut"],
};

/** Province → patch, derived so it cannot drift from PATCH_PROVINCES. */
export const PATCH_OF: Record<string, Patch> = Object.fromEntries(
  PATCHES.flatMap((patch) =>
    PATCH_PROVINCES[patch].map((province) => [province, patch] as const),
  ),
) as Record<string, Patch>;

/** The label for a store whose province we do not recognise. */
export const UNKNOWN_PATCH = "Unknown";

export function patchFor(province: string | null | undefined): string {
  return (province && PATCH_OF[province]) || UNKNOWN_PATCH;
}
