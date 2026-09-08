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
