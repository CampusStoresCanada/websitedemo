/**
 * The directory's shape and its filter — pure, so both are testable.
 *
 * Split from member-directory.ts because that module is `server-only`: a
 * vitest import of it fails outright, which would leave the search and chip
 * rules verifiable only by clicking a page.
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
};

/**
 * The filter behind the directory's search box and department chips.
 *
 * Pure and exported so it can be tested without a browser — the behaviour that
 * matters here (booth-number search, additive chips) is a set of small rules
 * that are easy to get subtly wrong and hard to eyeball on a page of 32 cards.
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
  const q = query.trim().toLowerCase();
  return listings.filter((l) => {
    if (picked.size > 0 && !l.departments.some((d) => picked.has(d))) return false;
    if (!q) return true;
    return (
      l.name.toLowerCase().includes(q) ||
      (l.description ?? "").toLowerCase().includes(q) ||
      // Booth numbers match from the start, never mid-string: typing "5"
      // should not surface booths 105, 205 and 502.
      l.booths.some((b) => b.toLowerCase().startsWith(q))
    );
  });
}

