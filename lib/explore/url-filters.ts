/**
 * URL query string <-> CompoundFilters for the explore/directory pages.
 *
 * Why only province and size live in the URL:
 *
 *   Province and FTE come off the organization record itself and are present
 *   for nearly every active member store, so neither can land a reader on an
 *   empty list on its own. Every other CompoundFilters field is either
 *   benchmarking-derived (pos, service, mandate, payment, shopping — present
 *   for roughly two thirds of members) or visibility-gated (pos/service/
 *   mandate are member-only in the refine panel, cancoll is reciprocal-only).
 *   A gated field in the query string would be a way to read gated data by
 *   watching which stores survive the filter, so those stay out of the URL
 *   entirely rather than being validated into it.
 *
 * Unknown, misspelled, or empty-cohort values are DROPPED, not applied. A link
 * with a bad value therefore renders the ordinary unfiltered page instead of a
 * blank list the reader cannot explain.
 */

import type { CompoundFilters, ScaleRange } from "./types";
import { SCALE_RANGES } from "./types";

/** Canonical query-string key for each supported filter. */
export const PROVINCE_PARAM = "province";
export const SIZE_PARAM = "size";

/**
 * Keys this module owns. Anything else in the query string (utm_source, a
 * campaign id, an anchor) is left untouched when we rewrite the URL.
 */
const OWNED_PARAMS = [PROVINCE_PARAM, SIZE_PARAM, "scaleRange"] as const;

/** Sentinel the province filter uses for "not in Canada" (see matchesProvinceFilter). */
export const INTERNATIONAL_PROVINCE = "__international__";

/**
 * Two-letter code -> the full name actually stored in organizations.province.
 * The DB holds full names ("Ontario"), but an email merge variable is almost
 * always the postal code, so both have to resolve.
 */
const PROVINCE_BY_CODE: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/** Alternate spellings that should resolve to a stored name. */
const PROVINCE_ALIASES: Record<string, string> = {
  "newfoundland": "Newfoundland and Labrador",
  "newfoundland & labrador": "Newfoundland and Labrador",
  "pei": "Prince Edward Island",
  "québec": "Quebec",
  "yukon territory": "Yukon",
};

const SCALE_RANGE_KEYS = new Set<string>(SCALE_RANGES.map((r) => r.key));

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a query-string province to the exact string stored on the org rows.
 *
 * `available` is the set of province values present in the cohort being
 * browsed. When supplied, a province that resolves correctly but holds no
 * stores (Nunavut today) is rejected, so the reader gets the national list
 * rather than an empty one.
 */
export function resolveProvinceParam(
  raw: string | null | undefined,
  available?: ReadonlySet<string>
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed === INTERNATIONAL_PROVINCE) return INTERNATIONAL_PROVINCE;

  const key = normalize(trimmed);

  let resolved: string | undefined;
  if (key.length === 2) {
    resolved = PROVINCE_BY_CODE[key.toUpperCase()];
  }
  if (!resolved) resolved = PROVINCE_ALIASES[key];
  if (!resolved) {
    resolved = Object.values(PROVINCE_BY_CODE).find((name) => normalize(name) === key);
  }
  if (!resolved) return undefined;

  if (available && !available.has(resolved)) return undefined;
  return resolved;
}

/** Resolve a query-string size band to a ScaleRange key. */
export function resolveSizeParam(raw: string | null | undefined): ScaleRange | undefined {
  if (!raw) return undefined;
  const key = normalize(raw);
  if (!key) return undefined;
  return SCALE_RANGE_KEYS.has(key) ? (key as ScaleRange) : undefined;
}

/** The set of province values present in a cohort, for validating a param against real data. */
export function provinceVocabulary(
  orgs: readonly { province: string | null }[]
): Set<string> {
  const set = new Set<string>();
  for (const org of orgs) {
    if (org.province && org.province !== "Out of Canada") set.add(org.province);
  }
  return set;
}

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search);
}

/**
 * Read supported filters out of a query string. Returns only the keys that
 * resolved — an unrecognised value yields no key at all, which is what makes a
 * bad link behave like a bare visit.
 */
export function parseExploreFilterParams(
  search: string | URLSearchParams,
  options: { availableProvinces?: ReadonlySet<string> } = {}
): CompoundFilters {
  const params = toSearchParams(search);
  const filters: CompoundFilters = {};

  const province = resolveProvinceParam(params.get(PROVINCE_PARAM), options.availableProvinces);
  if (province) filters.province = province;

  const size = resolveSizeParam(params.get(SIZE_PARAM) ?? params.get("scaleRange"));
  if (size) filters.scaleRange = size;

  return filters;
}

/**
 * Rewrite a query string so it reflects the active filters, preserving every
 * param this module does not own. Returns the new search string including a
 * leading "?" (or "" when nothing is left).
 */
export function writeExploreFilterParams(
  search: string | URLSearchParams,
  filters: CompoundFilters
): string {
  const params = toSearchParams(search);
  for (const key of OWNED_PARAMS) params.delete(key);

  if (filters.province) params.set(PROVINCE_PARAM, filters.province);
  if (filters.scaleRange) params.set(SIZE_PARAM, filters.scaleRange);

  const next = params.toString();
  return next ? `?${next}` : "";
}
