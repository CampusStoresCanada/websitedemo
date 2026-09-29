/**
 * The systems campus stores actually run, taken from what 39 stores typed in
 * FY2025 rather than from a vendor list.
 *
 * ⛔ Plain module, not "use server".
 *
 * Free text gave us the same product under four names — "Netsuite" and "Oracle
 * Netsuite", "Prism", "PrismRBS" and "PrismPOS - MOSAIC", "WISL" and "Waterloo
 * Information Systems Limited". Every one of those splits a cut that should
 * have been one row, and no amount of careful analysis afterwards can tell a
 * genuine variant from a typo.
 *
 * Each list keeps Other with a free-text box: a closed list would reject the
 * honest answer, and this year's Other is next year's option.
 */

export const POS_SYSTEMS = [
  "Bookware (Carleton Technologies)",
  "PrismRBS",
  "Lightspeed",
  "NetSuite",
  "MBS",
  "Waterloo Information Systems (WISL)",
  "Ratex",
  "Built in house",
  "Other",
] as const;

export const EBOOK_SYSTEMS = [
  "CEI",
  "VitalSource",
  "Kivuto",
  "Built in house",
  "Other",
] as const;

export const SIS_SYSTEMS = [
  "Banner",
  "PeopleSoft",
  "Colleague",
  "Workday Student",
  "Omnivox",
  "Salesforce",
  "Built by the institution",
  "Other",
] as const;

export const LMS_SYSTEMS = [
  "D2L / Brightspace",
  "Moodle",
  "Canvas",
  "Blackboard",
  "LEA",
  "Other",
] as const;

/** Who actually runs an Inclusive or Equitable Access programme. */
export const IA_OPERATORS = ["The institution", "In house", "Other"] as const;

export const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "student", label: "Student" },
  { value: "seasonal", label: "Seasonal" },
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];
