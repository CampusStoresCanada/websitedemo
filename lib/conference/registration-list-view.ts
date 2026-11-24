/**
 * The Registrations screen's list, as pure functions: filter, search, sort,
 * count and CSV. No reads here, so the page and its tests share one rule and
 * the browser can run it.
 */

/**
 * Which badge the person wears, by the colour of its overlay: delegate red,
 * exhibitor blue, CSC staff white (Steve, 2026-11-24).
 */
export type BadgeColour = "delegate" | "exhibitor" | "staff";

export type RegistrationListSeat = {
  seatId: string;
  organizationId: string;
  organizationName: string;
  badge: BadgeColour;
  registrationName: string;
  /** Null: the seat is bought and nobody is named to it yet. */
  holderPersonId: string | null;
  holderName: string | null;
  /** From the person's conference record; null when they have not given one. */
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

export const BADGE_LABEL: Record<BadgeColour, string> = {
  delegate: "Delegate",
  exhibitor: "Exhibitor",
  staff: "Staff",
};

export type SortKey = "name" | "organization" | "registration";
export type RegistrationFilters = {
  badge: BadgeColour | "all";
  /** A registration's name, or "all". */
  registration: string;
  named: "named" | "unnamed" | "all";
};
export const DEFAULT_FILTERS: RegistrationFilters = { badge: "all", registration: "all", named: "named" };

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const SORT_VALUE: Record<SortKey, (seat: RegistrationListSeat) => string> = {
  name: (s) => s.holderName ?? "",
  organization: (s) => s.organizationName,
  registration: (s) => s.registrationName,
};

/**
 * The rows to show.
 *
 * ⛔ A search looks through EVERY registration, named or not, whatever the
 * filters say (Steve, 2026-11-24): somebody typing a name wants that person,
 * not "no match" because a filter happens to be hiding them.
 */
export function viewRegistrations(
  seats: readonly RegistrationListSeat[],
  options: { query: string; filters: RegistrationFilters; sort: { key: SortKey; descending: boolean } }
): RegistrationListSeat[] {
  const q = options.query.trim().toLowerCase();
  const { badge, registration, named } = options.filters;
  const kept = q
    ? seats.filter((s) =>
        [
          s.holderName,
          s.organizationName,
          s.registrationName,
          BADGE_LABEL[s.badge],
          s.email,
          s.emergencyContactName,
          s.emergencyContactPhone,
        ].some((part) => (part ?? "").toLowerCase().includes(q))
      )
    : seats.filter(
        (s) =>
          (badge === "all" || s.badge === badge) &&
          (registration === "all" || s.registrationName === registration) &&
          (named === "all" || (named === "named") === Boolean(s.holderPersonId))
      );
  const value = SORT_VALUE[options.sort.key];
  return [...kept].sort((a, b) => {
    // Unnamed seats go last whichever way the names run.
    if (options.sort.key === "name" && Boolean(a.holderPersonId) !== Boolean(b.holderPersonId)) {
      return a.holderPersonId ? -1 : 1;
    }
    const order =
      compare(value(a), value(b)) ||
      compare(a.organizationName, b.organizationName) ||
      compare(a.holderName ?? "", b.holderName ?? "");
    return options.sort.descending ? -order : order;
  });
}

export type BadgeCount = { people: number; organizations: number; unnamed: number };

/** Named people, the organizations holding a registration, and seats still unnamed, per badge. */
export function countRegistrations(seats: readonly RegistrationListSeat[]): Record<BadgeColour | "all", BadgeCount> {
  const count = (rows: readonly RegistrationListSeat[]): BadgeCount => ({
    people: rows.filter((s) => s.holderPersonId).length,
    organizations: new Set(rows.map((s) => s.organizationId)).size,
    unnamed: rows.filter((s) => !s.holderPersonId).length,
  });
  return {
    all: count(seats),
    delegate: count(seats.filter((s) => s.badge === "delegate")),
    exhibitor: count(seats.filter((s) => s.badge === "exhibitor")),
    staff: count(seats.filter((s) => s.badge === "staff")),
  };
}

/** Quote a cell, and defuse a leading = + - @ the way the roster export does. */
function cell(value: string): string {
  return `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

export const REGISTRATION_CSV_HEADER = [
  "Name",
  "Organization",
  "Registration type",
  "Badge",
  "Email",
  "Emergency contact",
  "Emergency contact phone",
];

export function registrationsCsv(seats: readonly RegistrationListSeat[]): string {
  const lines = seats.map((s) =>
    [
      s.holderName ?? "",
      s.organizationName,
      s.registrationName,
      BADGE_LABEL[s.badge],
      s.email ?? "",
      s.emergencyContactName ?? "",
      s.emergencyContactPhone ?? "",
    ]
      .map(cell)
      .join(",")
  );
  return [REGISTRATION_CSV_HEADER.map(cell).join(","), ...lines].join("\n");
}
