/** Canadian provinces and territories */
export const PROVINCES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
] as const;

export type Province = (typeof PROVINCES)[number];

/** Canada Post two-letter codes, keyed by the full names stored in the DB. */
export const PROVINCE_ABBREVIATIONS: Record<Province, string> = {
  Alberta: "AB",
  "British Columbia": "BC",
  Manitoba: "MB",
  "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL",
  "Northwest Territories": "NT",
  "Nova Scotia": "NS",
  Nunavut: "NU",
  Ontario: "ON",
  "Prince Edward Island": "PE",
  Quebec: "QC",
  Saskatchewan: "SK",
  Yukon: "YT",
};

/**
 * Full province name → two-letter code. Returns the input unchanged when it is
 * already a code, or is something we don't recognise ("Out of Canada" appears
 * in real organization rows), so callers never render an empty province.
 */
export function abbreviateProvince(province: string | null | undefined): string {
  if (!province) return "";
  const trimmed = province.trim();
  return PROVINCE_ABBREVIATIONS[trimmed as Province] ?? trimmed;
}
