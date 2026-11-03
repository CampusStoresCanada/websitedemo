/**
 * Read-time aliases for the §9 Technology & Systems answers.
 *
 * ⛔ NEVER write a canonical value back over what a store filed. The multiselect
 * migration (20260930100000_benchmarking_systems_multiselect) deliberately kept
 * each store's own spelling, on the principle stated in field-registry.ts:
 * deciding that "Oracle Netsuite" meant "NetSuite" is the store's call to make
 * when it files, not ours to make on its behalf in a migration. An alias
 * resolved at read time stays revisable; a value persisted over theirs becomes
 * permanent and indistinguishable from something they actually declared.
 *
 * So this module is applied where answers are GROUPED, COUNTED or FILTERED —
 * the directory, the map stories, the facet dropdown — and deliberately NOT:
 *
 *  - on a store's own profile, where it should see the words it wrote; and
 *  - in lib/circle/space-rules.ts, because a Circle rule keyed on a survey
 *    answer decides who gets into a space. Folding variants together there
 *    changes access, which is a decision for an operator, not a lookup table.
 *
 * Grouping confirmed by Steve 2026-11-02: the Prism entries are different eras
 * of one product, and WISL / Netsuite are spelling variants of one vendor each.
 */

/** The §9 fields that carry a system name. All four are text[] in the database. */
export type BenchmarkingSystemField =
  | "pos_system"
  | "lms_system"
  | "ebook_delivery_system"
  | "student_info_system";

export interface SystemAliasGroup {
  /** The label every variant renders down to. Matches the field-registry option. */
  canonical: string;
  /** Spellings seen in filed answers, including the canonical one. */
  variants: string[];
}

/**
 * Only `pos_system` has confirmed groups. The other three are present so a
 * future grouping has an obvious home — an empty list means "no aliasing", which
 * is the correct default: an unreviewed guess is worse than two separate rows.
 */
export const SYSTEM_ALIAS_GROUPS: Record<BenchmarkingSystemField, SystemAliasGroup[]> = {
  pos_system: [
    {
      // Different eras of Prism rather than different platforms.
      canonical: "Prism",
      variants: ["Prism", "PrismRBS", "PrismPOS - MOSAIC", "Prism POS", "Prism RBS"],
    },
    {
      canonical: "Waterloo Information Systems (WISL)",
      variants: [
        "Waterloo Information Systems (WISL)",
        "Waterloo Information Systems Limited",
        "Waterloo Information Systems",
        "WISL",
      ],
    },
    {
      canonical: "NetSuite",
      variants: ["NetSuite", "Netsuite", "Oracle Netsuite", "Oracle NetSuite"],
    },
  ],
  lms_system: [],
  ebook_delivery_system: [],
  student_info_system: [],
};

/**
 * Casing and spacing vary because these arrive as free text; "Netsuite" and
 * "NetSuite" are the same answer. Matching is exact on this normalized key, not
 * fuzzy — a prefix match would fold "Prism" into "PrismRBS" on spelling alone
 * and would eventually fold two genuinely different products together.
 */
function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const LOOKUP: Record<BenchmarkingSystemField, Map<string, string>> = (() => {
  const out = {} as Record<BenchmarkingSystemField, Map<string, string>>;
  for (const field of Object.keys(SYSTEM_ALIAS_GROUPS) as BenchmarkingSystemField[]) {
    const map = new Map<string, string>();
    for (const group of SYSTEM_ALIAS_GROUPS[field]) {
      for (const variant of group.variants) {
        map.set(normalizeKey(variant), group.canonical);
      }
    }
    out[field] = map;
  }
  return out;
})();

/** One value in, its canonical label out. Unknown values pass through unchanged. */
export function canonicalSystem(field: BenchmarkingSystemField, value: string): string {
  return LOOKUP[field].get(normalizeKey(value)) ?? value;
}

/**
 * Maps every value and drops duplicates that collapsing creates — a store that
 * filed both "Prism" and "PrismRBS" runs one platform, and must not be counted
 * twice in the same facet. Order of first appearance is preserved so display
 * stays stable. `null` in, `null` out; an empty array stays empty.
 */
export function canonicalSystems(
  field: BenchmarkingSystemField,
  values: string[] | null
): string[] | null {
  if (values === null) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const canonical = canonicalSystem(field, value);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}
