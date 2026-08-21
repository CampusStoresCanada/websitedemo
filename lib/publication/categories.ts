/**
 * The NACS taxonomy — the publication's category model, and the one members
 * and partners both choose from.
 *
 * This is home base, and it is worth being precise about where it lives:
 *
 *   - `VENDOR_CATEGORIES` + `CATEGORY_SUBCATEGORIES` (lib/types/procurement.ts)
 *     ARE the taxonomy. CategoryEditor.tsx renders exactly this and labels it
 *     "Full NACS taxonomy"; members select from the same list to say what they
 *     carry. Imported here rather than restated — one vocabulary, one file.
 *   - `organizations.primary_category` holds what the org actually SELECTED,
 *     comma-joined, departments and classes flattened into one string. It is a
 *     controlled vocabulary stored denormalised — not free text.
 *   - `organizations.nacs_department` / `nacs_classes` are AI-COMPUTED
 *     SUGGESTIONS, surfaced in the editor as "Likely" chips for a human to
 *     accept. They are populated for all 78 partners because a machine filled
 *     them in, which makes them useless as evidence that anyone chose anything.
 *     Never read them as the category of record.
 *
 * So: parse `primary_category` against the taxonomy. Anything that doesn't
 * match is legacy drift needing a human, and is reported rather than hidden.
 */

import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

/** Top level of the taxonomy — the headings a printed index is grouped under. */
export const NACS_DEPARTMENTS: readonly string[] = VENDOR_CATEGORIES;

/** Second level, keyed by department. */
export const NACS_CLASSES_BY_DEPARTMENT = CATEGORY_SUBCATEGORIES;

/** class label → its department, so a class alone still indexes correctly. */
const DEPARTMENT_BY_CLASS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const dept of NACS_DEPARTMENTS) {
    for (const cls of NACS_CLASSES_BY_DEPARTMENT[dept] ?? []) map[cls] = dept;
  }
  return map;
})();

/**
 * Spelling drift found in live data (2026-08-20) that means a real taxonomy
 * value. Punctuation-only variants get mapped rather than reported, so a
 * missing space doesn't read as a partner failing to pick a category.
 * Genuinely different labels ("General Merchandise", "Operations & Support",
 * "Course-Related Devices", "Digital Course Materials") are NOT aliased —
 * they're from an older taxonomy and need a human to re-map them.
 */
const ALIASES: Record<string, string> = {
  "Men's/Unisex": "Men's / Unisex",
  "Infant/Toddler": "Infant & Toddler",
};

export type ParsedCategories = {
  /** Departments to index under — explicitly chosen, plus any implied by a class. */
  departments: string[];
  /** Classes chosen, in taxonomy order. */
  classes: string[];
  /** Tokens outside the taxonomy — legacy values a human has to re-map. */
  unrecognized: string[];
};

const EMPTY: ParsedCategories = { departments: [], classes: [], unrecognized: [] };

/**
 * Split a stored `primary_category` into structured taxonomy terms.
 *
 * A class implies its department: an org that picked only "Caps & Gowns" still
 * belongs under "Graduation & Regalia" in the index. Without that, a listing
 * silently vanishes from the section a reader would look for it in.
 */
export function parseOrgCategories(raw: string | null | undefined): ParsedCategories {
  if (!raw || !raw.trim()) return EMPTY;

  const departments = new Set<string>();
  const classes = new Set<string>();
  const unrecognized: string[] = [];

  for (const rawToken of raw.split(",")) {
    const token = ALIASES[rawToken.trim()] ?? rawToken.trim();
    if (!token) continue;

    if (NACS_DEPARTMENTS.includes(token)) {
      departments.add(token);
    } else if (DEPARTMENT_BY_CLASS[token]) {
      classes.add(token);
      departments.add(DEPARTMENT_BY_CLASS[token]);
    } else if (!unrecognized.includes(token)) {
      unrecognized.push(token);
    }
  }

  // Taxonomy order, not selection order — the index reads the same every time.
  const allClasses = NACS_DEPARTMENTS.flatMap((d) => NACS_CLASSES_BY_DEPARTMENT[d] ?? []);
  return {
    departments: NACS_DEPARTMENTS.filter((d) => departments.has(d)),
    classes: allClasses.filter((c) => classes.has(c)),
    unrecognized,
  };
}

/**
 * True when an org has at least one real department to be listed under —
 * the bar for appearing in a category index at all.
 */
export function hasListableCategories(raw: string | null | undefined): boolean {
  return parseOrgCategories(raw).departments.length > 0;
}
