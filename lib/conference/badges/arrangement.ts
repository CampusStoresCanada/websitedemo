/**
 * How a print file is stacked.
 *
 * This is a PREFLIGHT question, not a design one: the editor answers "does this
 * badge look right", and this answers "what order do they come off the printer
 * in, and what is grouped with what". Both matter; they are different jobs and
 * they belong at different points in the flow.
 *
 * ⛔ The old model hardcoded CSC's current answer: exactly two badge types
 * (delegate, exhibitor), each with its own fixed sort. Those choices are right
 * for CSC — delegates by last name A-Z, exhibitors by organisation A-Z — and
 * wrong as a model, because they assume every conference sells two things and
 * wants them ordered the same way. Another organiser may want one pile sorted
 * by registration date, or by membership number, or may not care at all.
 *
 * So: a conference has whatever registration types it has. An arrangement is an
 * ordered list of SECTIONS; each section joins one or more of those types and
 * says how to sort within it. Sections come off the printer in the order given.
 */

export const BADGE_SORT_KEYS = [
  "person_last_name",
  "person_first_name",
  "organization_name",
  "hotel_room_number",
  "registration_type",
  "seated_at",
] as const;

export type BadgeSortKey = (typeof BADGE_SORT_KEYS)[number];

export const BADGE_SORT_LABELS: Record<BadgeSortKey, string> = {
  person_last_name: "Last name",
  person_first_name: "First name",
  organization_name: "Organisation",
  hotel_room_number: "Hotel room",
  registration_type: "Registration type",
  seated_at: "When they were seated",
};

export type BadgeArrangementSection = {
  /** Stable id so the operator can reorder without the section losing identity. */
  id: string;
  /** The operator's word for this pile — "Exhibitors", "Thursday walk-ins". */
  label: string;
  /** The registration types stacked into this section. One, or several joined. */
  entityIds: string[];
  sortBy: BadgeSortKey;
  direction: "asc" | "desc";
};

export type BadgeArrangement = { sections: BadgeArrangementSection[] };

/** The minimum a badge must expose to be arranged. */
export type ArrangeableBadge = {
  entityId: string;
  entityName: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  organizationName: string | null;
  roomNumber: string | null;
  /** When the seat was allocated — the closest thing to a registration date. */
  seatedAt: string | null;
};

/**
 * The arrangement a conference gets before anyone touches it: one section per
 * registration type, in the order given, each sorted by last name A–Z.
 *
 * Deliberately not "everything in one pile" — a printer stack that keeps types
 * together is useful even when nobody has expressed a preference, and it makes
 * the grouping control discoverable by showing what a section IS.
 */
export function defaultArrangement(
  types: Array<{ entityId: string; name: string }>
): BadgeArrangement {
  return {
    sections: types.map((t) => ({
      id: t.entityId,
      label: t.name,
      entityIds: [t.entityId],
      sortBy: "person_last_name",
      direction: "asc",
    })),
  };
}

function deriveNames(row: Record<string, unknown>): {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
} {
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (first || last) {
    return {
      firstName: first || null,
      lastName: last || null,
      displayName: `${first} ${last}`.trim() || null,
    };
  }
  if (!display) return { firstName: null, lastName: null, displayName: null };
  const parts = display.split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    displayName: display,
  };
}

/**
 * The name on a badge. ⛔ ONE rule for the printed badge, the desk's reprint
 * sticker and every printed name list: the person's contact record (first /
 * last name) when they have one, otherwise the roster row (deriveNames: the
 * FIRST word is the given name). The sticker once split at the LAST word
 * instead, and printed "DESK TEST THURSDAY / Only" for a badge that reads
 * "DESK / Test Thursday Only".
 */
export function badgeNames(
  row: Record<string, unknown>,
  canonicalPerson: { first_name: string | null; last_name: string | null } | null
): { firstName: string | null; lastName: string | null; displayName: string | null } {
  return canonicalPerson
    ? {
        firstName: canonicalPerson.first_name?.trim() || null,
        lastName: canonicalPerson.last_name?.trim() || null,
        displayName: `${canonicalPerson.first_name ?? ""} ${canonicalPerson.last_name ?? ""}`.trim() || null,
      }
    : deriveNames(row);
}

/**
 * How someone likes a printed list of names: the door list, the attendee list.
 *
 * Stephen, 2026-10-21: "I like Alphabetical by first name, my colleague likes
 * by last name … it shouldn't be while you are attempting the panic print on
 * an iPad." So it is set once, per account, in the War Room, and a print page
 * reads the viewer's choice. The words are the badge run's own — one sort
 * vocabulary, not a second.
 */
export const PRINT_SORT_KEYS = ["person_first_name", "person_last_name", "organization_name"] as const;
export type PrintSortKey = (typeof PRINT_SORT_KEYS)[number];
export const DEFAULT_PRINT_SORT: PrintSortKey = "person_last_name";
/** Key inside profiles.preferences. */
export const PRINT_SORT_PREFERENCE_KEY = "print_sort";

export function parsePrintSort(value: unknown): PrintSortKey {
  return (PRINT_SORT_KEYS as readonly unknown[]).includes(value) ? (value as PrintSortKey) : DEFAULT_PRINT_SORT;
}

/** The fields a printed name list sorts by. */
export type SortableName = Pick<ArrangeableBadge, "firstName" | "lastName" | "displayName" | "organizationName">;

/**
 * A name list in the viewer's order. By company keeps each company's people
 * together, last name A–Z inside it.
 */
export function sortNames<T extends SortableName>(rows: T[], key: PrintSortKey): T[] {
  const value = (row: T, k: BadgeSortKey) =>
    sortValue({ entityId: "", entityName: "", roomNumber: null, seatedAt: null, ...row }, k);
  return [...rows].sort((a, b) => {
    const primary = value(a, key).localeCompare(value(b, key));
    if (primary !== 0) return primary;
    if (key === "organization_name") {
      const within = value(a, "person_last_name").localeCompare(value(b, "person_last_name"));
      if (within !== 0) return within;
    }
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });
}

function sortValue(badge: ArrangeableBadge, key: BadgeSortKey): string {
  switch (key) {
    case "person_first_name":
      return (badge.firstName || badge.displayName || "").trim().toLowerCase();
    case "organization_name":
      return (badge.organizationName || "").trim().toLowerCase();
    case "hotel_room_number":
      // Room numbers sort as numbers where they are numbers — "10" after "9",
      // not before it. Padded rather than parsed so "12B" still behaves.
      return (badge.roomNumber || "").trim().toLowerCase().replace(/\d+/g, (d) => d.padStart(8, "0"));
    case "registration_type":
      return (badge.entityName || "").trim().toLowerCase();
    case "seated_at":
      return badge.seatedAt ?? "";
    case "person_last_name":
    default:
      return (badge.lastName || badge.displayName || "").trim().toLowerCase();
  }
}

/**
 * Apply an arrangement, returning the sections in print order.
 *
 * Any badge whose type is in no section still comes out — in a trailing
 * "Unassigned" section rather than being dropped. A badge silently missing from
 * a print run is the most expensive failure this pipeline has, so an
 * arrangement that has fallen behind the catalogue degrades to "printed, in the
 * wrong pile" rather than "not printed".
 */
export function arrangeBadges<T extends ArrangeableBadge>(
  badges: T[],
  arrangement: BadgeArrangement
): Array<{ section: BadgeArrangementSection; badges: T[] }> {
  const claimed = new Set<string>();
  const out = arrangement.sections.map((section) => {
    const inSection = badges.filter((b) => section.entityIds.includes(b.entityId));
    for (const b of inSection) claimed.add(b.entityId);
    const dir = section.direction === "desc" ? -1 : 1;
    const sorted = [...inSection].sort((a, b) => {
      const cmp = sortValue(a, section.sortBy).localeCompare(sortValue(b, section.sortBy));
      if (cmp !== 0) return cmp * dir;
      // Stable tiebreak so the same roster always produces the same file.
      return (a.displayName ?? "").localeCompare(b.displayName ?? "");
    });
    return { section, badges: sorted };
  });

  const orphans = badges.filter((b) => !claimed.has(b.entityId));
  if (orphans.length > 0) {
    out.push({
      section: {
        id: "__unassigned__",
        label: "Not in any section",
        entityIds: [...new Set(orphans.map((b) => b.entityId))],
        sortBy: "person_last_name",
        direction: "asc",
      },
      badges: [...orphans].sort((a, b) =>
        sortValue(a, "person_last_name").localeCompare(sortValue(b, "person_last_name"))
      ),
    });
  }
  return out;
}

/** Narrow unknown jsonb to an arrangement, falling back to the default. */
export function normalizeArrangement(
  value: unknown,
  types: Array<{ entityId: string; name: string }>
): BadgeArrangement {
  const fallback = defaultArrangement(types);
  if (!value || typeof value !== "object") return fallback;
  const sections = (value as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) return fallback;
  const known = new Set(BADGE_SORT_KEYS as readonly string[]);
  const known2 = new Set(types.map((t) => t.entityId));
  const cleaned = sections
    .map((raw, i) => {
      const s = raw as Partial<BadgeArrangementSection>;
      const entityIds = Array.isArray(s.entityIds)
        ? s.entityIds.filter((id): id is string => typeof id === "string")
        : [];
      if (entityIds.length === 0) return null;
      return {
        id: typeof s.id === "string" && s.id ? s.id : `section-${i}`,
        label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : `Section ${i + 1}`,
        entityIds,
        sortBy: (typeof s.sortBy === "string" && known.has(s.sortBy)
          ? s.sortBy
          : "person_last_name") as BadgeSortKey,
        direction: s.direction === "desc" ? ("desc" as const) : ("asc" as const),
      };
    })
    .filter((s): s is BadgeArrangementSection => s !== null);
  if (cleaned.length === 0) return fallback;

  // ⛔ RECONCILE AGAINST THE LIVE CATALOGUE. A saved arrangement is a snapshot
  // of the types that existed when it was saved. Add a Speaker type tomorrow and
  // it is in no section — so it would be invisible in the UI and land in the
  // "not in any section" pile the moment somebody bought one. Any type the
  // catalogue has and the arrangement does not gets its own pile, at the end,
  // where the admin can see it and move it.
  //
  // Types that have VANISHED from the catalogue are dropped from their sections
  // for the same reason: an arrangement should describe what exists now.
  const placed = new Set(cleaned.flatMap((s) => s.entityIds));
  const reconciled = cleaned
    .map((section) => ({
      ...section,
      entityIds: section.entityIds.filter((id) => known2.has(id)),
    }))
    .filter((section) => section.entityIds.length > 0);
  for (const type of types) {
    if (placed.has(type.entityId)) continue;
    reconciled.push({
      id: type.entityId,
      label: type.name,
      entityIds: [type.entityId],
      sortBy: "person_last_name",
      direction: "asc",
    });
  }
  return { sections: reconciled };
}
