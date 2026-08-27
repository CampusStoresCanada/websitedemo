import type { HomeMapOrg } from "@/lib/homepage";

/**
 * Text matching for the explore/directory search box.
 *
 * Extracted so the two call sites in MapExplore (the lens pool and the
 * partners-page hybrid search) can't drift apart — they were duplicate
 * inline predicates before booth numbers were added.
 */

/** Bare "402", or "booth 402" / "Booths 402" → "402". Anything else → null. */
export function boothToken(query: string): string | null {
  const match = query.trim().match(/^(?:booths?\s+)?([a-z]?\d{1,4}[a-z]?)$/i);
  return match ? match[1].toLowerCase() : null;
}

export const EXHIBITOR_WORDS = /^(exhibitor|exhibitors|exhibiting|booth|booths)$/i;

/**
 * Does this set of booth numbers answer the query?
 *
 * Exported so every surface that searches booths uses ONE rule. The conference
 * map and the exhibitor directory each grew their own prefix-matching version,
 * which reintroduced exactly the noise this whole-token rule exists to stop:
 * typing "40" returning booths 40, 400, 402 and 408 at once.
 */
export function boothsMatch(booths: readonly string[], rawQuery: string): boolean {
  if (booths.length === 0) return false;
  if (EXHIBITOR_WORDS.test(rawQuery.trim())) return true;
  const token = boothToken(rawQuery);
  return token !== null && booths.some((b) => b.toLowerCase() === token);
}

export function orgMatchesQuery(org: HomeMapOrg, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  if (org.name.toLowerCase().includes(query)) return true;
  if (org.city?.toLowerCase().includes(query)) return true;
  if (org.province?.toLowerCase().includes(query)) return true;

  const booths = org.exhibitorBooths ?? [];
  if (booths.length === 0) return false;

  // Booth numbers match WHOLE, not by substring: someone with a printed floor
  // plan types "402" to find who's there, and a substring match would make
  // "40" return booths 40, 400, 402 and 408 at once — noise, not an answer.
  return boothsMatch(booths, rawQuery);
}
