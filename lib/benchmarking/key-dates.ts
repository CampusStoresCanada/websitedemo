/**
 * The dates a campus store's year actually turns on.
 *
 * ⛔ Plain module, not "use server" — see lib/benchmarking/location-kinds.ts for
 * what happens when a const is exported from an actions file.
 *
 * These are forward-looking and they belong to the ORGANISATION, not to one
 * submission: an adoption deadline is a fact about how the institution runs,
 * it outlives the survey that captured it, and the admin calendar should be
 * able to read it. The survey is simply the moment each year when somebody is
 * paying enough attention to confirm them.
 */

export type KeyDateKind =
  | "adoption_deadline"
  | "returns_cutoff"
  | "add_drop"
  | "buyback"
  | "semester"
  | "inventory_count"
  | "other";

export const KEY_DATE_KINDS: {
  value: KeyDateKind;
  label: string;
  help: string;
  /** Semesters run between two dates; everything else happens on one. */
  hasEnd?: boolean;
}[] = [
  {
    value: "adoption_deadline",
    label: "Textbook adoption deadline",
    help: "When faculty must have their course materials in to you. Add one per term if they differ.",
  },
  {
    value: "semester",
    label: "Semester",
    help: "Name it as your campus does — Fall 2026, Winter 2027 — with its first and last day.",
    hasEnd: true,
  },
  {
    value: "add_drop",
    label: "Add/drop deadline",
    help: "The last day a student can change courses. It sets the shape of your returns.",
  },
  {
    value: "returns_cutoff",
    label: "Textbook returns cut-off",
    help: "Your own deadline for a student to bring a book back.",
  },
  {
    value: "buyback",
    label: "Buyback",
    help: "When you buy books back from students. Add each window you run.",
    hasEnd: true,
  },
  {
    value: "inventory_count",
    label: "Inventory count",
    help: "When you count. Add each one if you count more than once.",
  },
  {
    value: "other",
    label: "Other",
    help: "Anything else the year turns on. Name it so it means something to you a year from now.",
  },
];

export const INVENTORY_COUNT_STYLES = [
  {
    value: "Annual",
    label: "Annual",
    help: "One full count a year.",
  },
  {
    value: "Bi-annual",
    label: "Bi-annual",
    help: "Two full counts a year.",
  },
  {
    value: "Cycle Counts",
    label: "Cycle counts",
    help: "Rolling counts through the year rather than closing to count everything at once.",
  },
  {
    value: "Other",
    label: "Other",
    help: "Describe how you count.",
  },
] as const;

/** Where a service sits on its journey, not just whether you have it. */
export type ServiceStatus = "offered" | "planned" | "discontinuing" | "na";

export const SERVICE_STATUSES: { value: ServiceStatus; label: string }[] = [
  { value: "offered", label: "Currently offer" },
  { value: "planned", label: "Plan to offer" },
  { value: "discontinuing", label: "Plan to discontinue" },
  { value: "na", label: "Not applicable" },
];

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Day = (typeof DAYS)[number];

/** Per-day hours for one location. A null day means closed that day. */
export type LocationHours = Partial<Record<Day, { open: string; close: string } | null>>;
