import { explainMatch } from "@/lib/explore/intent-search";

/**
 * The directory's shape and its filter.
 *
 * Matching delegates to lib/explore's shared rules — the map, this list and
 * the partners page are three windows onto the same question, and each having
 * its own predicate is how "402" came to mean three different things.
 */

export type DirectoryListing = {
  orgId: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  description: string | null;
  /** Ascending, as printed. Empty when they hold no booth of their own. */
  booths: string[];
  departments: string[];
  classes: string[];
  /** Consented names only — see MappedThing.people for the gate. */
  people: string[];
};

/**
 * Search box and department chips.
 *
 * Chips are ADDITIVE, not intersecting: picking Apparel and Drinkware shows
 * both aisles. Nobody browsing a trade show floor wants the empty set of
 * companies that sell both.
 */
export function filterListings(
  listings: DirectoryListing[],
  query: string,
  picked: ReadonlySet<string>
): DirectoryListing[] {
  return listings.filter((l) => {
    if (picked.size > 0 && !l.departments.some((d) => picked.has(d))) return false;
    if (!query.trim()) return true;
    return (
      explainMatch(
        {
          name: l.name,
          description: l.description,
          departments: l.departments,
          classes: l.classes,
          booths: l.booths,
          people: l.people,
        },
        query
      ) !== null
    );
  });
}
