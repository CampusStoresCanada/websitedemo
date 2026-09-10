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
/**
 * Legacy terms mapped onto the current taxonomy.
 *
 * ⛔ AN ALIAS, NEVER A REWRITE. These fix the READING of what a partner typed;
 * they do not edit `primary_category`. Overwriting the column would replace a
 * company's own description of what it sells with our guess, irreversibly and
 * without telling them — and the whole reason this data is worth anything is
 * that a human declared it.
 *
 * ⚠️ Only unambiguous renames belong here. Measured 2026-09-03: nine partners
 * carried terms from an older list, and SIX of them had no valid department at
 * all — meaning they appeared in NO category index anywhere: not the print
 * directory, not the member map, not the conference directory. Paying partners,
 * unfindable by category. These aliases restore five of the six.
 *
 * ⛔ Deliberately NOT aliased, because they are guesses about what a real
 * company sells rather than renames of a known thing:
 *   "General Merchandise"  (5 orgs) — spans most of the taxonomy; means nothing
 *   "Convenience Items"    (2 orgs) — food? sundries? tech accessories?
 *   "Other"                (1 org)  — The Fanatic Group; only a human can ask
 * Those need someone to pick, or the partner to re-select in the editor.
 */
const ALIASES: Record<string, string | readonly string[]> = {
  "Men's/Unisex": "Men's / Unisex",
  "Infant/Toddler": "Infant & Toddler",

  // Renamed when the taxonomy was tightened — same concept, current wording.
  "Gifts & Collectibles": "Gifts",
  "Lab Supplies & Equipment": "Lab Supplies",
  "Digital Course Materials": "Course Materials",
  "Print & Copy Services": "Print & Photocopy",
  "Operations & Support": "Store Operations",
  "Facilities & Furniture": "Store Fixtures & Equipment",

  /**
   * ⛔ COMPOUND TERMS MAP TO BOTH HALVES, because picking one is a guess.
   *
   * "Stationery & School Supplies" names two things that now live in two
   * different departments — Stationery under Accessories, Office Supplies under
   * School Office & Lab Supplies. Mapping it to just "Stationery" filed Crestar
   * (the Pilot pens distributor) under Accessories ALONE, so a buyer filtering
   * School Office & Lab Supplies would never find them. Raised by the
   * match-engine session, and it is the same objection that stopped me aliasing
   * "General Merchandise": the alias should not decide what a company sells.
   *
   * Both halves is not a guess — the label says both. Where the old term is
   * genuinely two terms, resolve it to two.
   */
  "Stationery & School Supplies": ["Stationery", "Office Supplies"],

  /**
   * ⚠️ APPAREL ONLY — and this was briefly ["Apparel", "Spirit Items"], which
   * was wrong. Spirit WEAR is branded clothing: hoodies, tees. "Spirit Items" is
   * a class of Gifts & Promotional Products and means pennants, mugs, souvenirs.
   * Mapping one to the other filed a clothing vendor as a giftware supplier.
   *
   * "Spirit Wear" is not in the taxonomy at all, and the honest reading of the
   * compound is that BOTH halves are clothing — so unlike "Stationery & School
   * Supplies", whose two halves genuinely name two departments, this one
   * resolves to a single department. A dual mapping is only right when the label
   * really does name two things.
   *
   * Caught by another session; impact was nil because the two orgs holding it
   * also declare "Gifts & Collectibles", but an apparel-only vendor using the
   * old wording would have been silently misfiled in the public directory.
   */
  "Apparel & Spirit Wear": "Apparel",
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
    const trimmed = rawToken.trim();
    if (!trimmed) continue;
    // An alias may expand to SEVERAL terms — a compound legacy label names more
    // than one thing, and dropping either half hides a partner from a filter.
    const aliased = ALIASES[trimmed];
    const tokens = aliased === undefined ? [trimmed] : Array.isArray(aliased) ? aliased : [aliased];

    for (const token of tokens) {
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
 * Split a stored selection into what an editor can SHOW as controls, and what it
 * cannot place at all.
 *
 * ⛔ EVERY CHIP IN A PICKER MUST HAVE A CONTROL BEHIND IT. `CategoryEditor`
 * rendered the raw stored terms as primary/secondary badges while its checkbox
 * list only knows the current taxonomy — so legacy terms appeared at the top
 * with nothing corresponding at the bottom, and the two halves of the dialog
 * looked unrelated. Steve: "selecting from the bottom doesn't populate the top
 * or vice versa... it seems like it really should."
 *
 * It also explains the double-vocabulary rows: an invisible legacy term was
 * carried forward on every save, so adding the modern category left both. RAINS
 * held "Apparel & Spirit Wear" AND "Apparel".
 *
 * ⚠️ RECOGNISED TERMS ARE NEVER EXPANDED. Only legacy ones are resolved through
 * ALIASES. If a partner picked just "Men's / Unisex", adding "Apparel" for them
 * would silently change which term is first — and first is what the editor
 * treats as their primary.
 *
 * Order is preserved, because position IS the primary/secondary distinction.
 */
export function splitStoredSelection(raw: string | null | undefined): {
  selected: string[];
  legacy: string[];
} {
  const tokens = (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const known = new Set<string>(NACS_DEPARTMENTS);
  for (const department of NACS_DEPARTMENTS) {
    for (const cls of NACS_CLASSES_BY_DEPARTMENT[department] ?? []) known.add(cls);
  }

  const selected: string[] = [];
  const legacy: string[] = [];
  for (const token of tokens) {
    if (known.has(token)) {
      if (!selected.includes(token)) selected.push(token);
      continue;
    }
    const parsed = parseOrgCategories(token);
    const terms = [...parsed.departments, ...parsed.classes];
    if (terms.length === 0) {
      if (!legacy.includes(token)) legacy.push(token);
      continue;
    }
    for (const term of terms) if (!selected.includes(term)) selected.push(term);
  }
  return { selected, legacy };
}

/**
 * The department an org considers its PRIMARY — first in THEIR order, not ours.
 *
 * ⛔ `parseOrgCategories().departments[0]` IS THE WRONG ANSWER FOR THIS. That
 * list is deliberately in taxonomy order so a printed index reads the same every
 * time, which means its first element has nothing to do with what the partner
 * picked first. Measured on live partners: 9 of 79 disagree, and for two of them
 * the system was naming a department they had not chosen first at all —
 * Lifestyle Market picked Gifts & Promotional Products and was being called
 * Accessories.
 *
 * `CategoryEditor` treats position as the primary (`selected[0]`, with a "Make
 * primary" control that reorders), so selection order IS the stored intent.
 * Honour it — but resolve through the parser, because the first term may be a
 * class or a legacy label rather than a department: "Course Materials" first
 * means Books, not nothing.
 */
export function primaryDepartment(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  for (const token of raw.split(",")) {
    const [department] = parseOrgCategories(token).departments;
    if (department) return department;
  }
  return null;
}

/**
 * True when an org has at least one real department to be listed under —
 * the bar for appearing in a category index at all.
 */
export function hasListableCategories(raw: string | null | undefined): boolean {
  return parseOrgCategories(raw).departments.length > 0;
}
