/**
 * A publication is a saved, re-runnable definition: **source + selection +
 * ordered sections**. Run it, get a directory. Change the selection, run it
 * again tomorrow, get a different one.
 *
 * The composition is the artifact; renderers consume it. Screen and print are
 * two renderers over ONE composed result, which is what keeps the printed
 * directory from drifting away from the live map — they are not two pipelines
 * that happen to agree.
 *
 * Deliberately not conference-only. `PublicationSource` covers "the exhibitors
 * at conference X" and "every active partner" with the same machinery, because
 * the ask was a tool the organisation can run for any directory, not the 2027
 * conference's directory generator.
 *
 * Pure and DB-free: `loadDirectoryEntries()` (composition-loader.ts) gathers the
 * rows, this file decides what goes where. That split is what makes section
 * ordering, grouping and index-building testable without a database.
 */

import { parseOrgCategories, NACS_DEPARTMENTS } from "./categories";
import type { OrgCompleteness } from "./completeness";

// ─────────────────────────────────────────────────────────────────────────────
// Definition
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationSource =
  /** Orgs holding a booth at one conference — the conference directory. */
  | { kind: "conference"; conferenceId: string }
  /** Every active org of a type — a standing member or partner directory. */
  | { kind: "organizations"; orgType: string };

export type PublicationSelection = {
  /**
   * Scope to specific organizations. Unlike the filters below this is not an
   * editorial exclusion — it narrows what the publication IS, so the excluded
   * entries are never counted as dropped. A single-org proof and the full
   * directory are the same publication at different scopes, which is what lets
   * an exhibitor see their own entry rendered by the exact code that prints it.
   */
  orgIds?: string[];
  /** Restrict to these NACS departments. Empty/absent = all. */
  departments?: string[];
  /**
   * Drop entries missing a required field. Defaults to false: a thin listing is
   * usually better than a missing one, and the gap report is where completeness
   * gets chased — not here, silently, at render time.
   */
  printReadyOnly?: boolean;
};

export type PublicationSection =
  /** The listings themselves. */
  | { type: "listings"; title?: string; groupBy: "category" | "name" | "booth" }
  /** Department → who's in it. The index a reader scans first. */
  | { type: "category_index"; title?: string }
  /** Booth number → who's in it. Only meaningful for a conference source. */
  | { type: "booth_index"; title?: string }
  /** One page per surface, or a named surface. */
  | { type: "map"; title?: string; surfaceId?: string }
  /** Editorial: cover copy, a welcome letter, sponsor thanks. */
  | { type: "static"; title: string; body: string };

export type Publication = {
  id: string;
  title: string;
  source: PublicationSource;
  selection: PublicationSelection;
  sections: PublicationSection[];
};

/**
 * The CSC conference directory as it ships today. A starting definition, not a
 * hardcoded pipeline — every field here is editable, and a second publication is
 * another object, not another code path.
 */
export function conferenceDirectory(conferenceId: string, title: string): Publication {
  return {
    id: `conference-directory-${conferenceId}`,
    title,
    source: { kind: "conference", conferenceId },
    selection: {},
    sections: [
      { type: "map", title: "Floor Plan" },
      { type: "category_index", title: "By Category" },
      { type: "listings", title: "Exhibitors", groupBy: "category" },
      { type: "booth_index", title: "By Booth Number" },
    ],
  };
}

/**
 * One exhibitor's own listing, rendered by the same code that prints the book.
 *
 * The point is fidelity, not a preview widget: an approval means nothing if the
 * thing approved was drawn by different code than the thing printed. Same
 * composer, same renderer, same stylesheet — just scoped to one org and without
 * the indexes, which say nothing about a single entry.
 */
export function orgListingProof(conferenceId: string, orgId: string, title: string): Publication {
  return {
    id: `listing-proof-${orgId}`,
    title,
    source: { kind: "conference", conferenceId },
    selection: { orgIds: [orgId] },
    sections: [{ type: "listings", title: "Your listing", groupBy: "name" }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Input rows
// ─────────────────────────────────────────────────────────────────────────────

/** One org as the publication sees it. Built by composition-loader.ts. */
export type DirectoryEntry = {
  orgId: string;
  orgName: string;
  orgSlug: string | null;
  logoUrl: string | null;
  description: string | null;
  featuredProduct: string | null;
  featuredProductDetail: string | null;
  catalogueUrl: string | null;
  /** Raw `primary_category` — parsed here, so the taxonomy lives in one place. */
  rawCategories: string | null;
  /** Booth numbers held, ascending. Empty for a non-conference source. */
  boothNumbers: string[];
  completeness: OrgCompleteness;
};

export type SurfaceForPublication = {
  id: string;
  name: string;
  imageUrl: string | null;
  level: number;
};

/**
 * One thing drawn on a surface. Coordinates are fractions of the background
 * image (0..1), so the same numbers render at any size — a phone, a spread, or
 * a press-ready page — which is what makes the vector floor plan free for print.
 */
export type PlacedThing = {
  entityId: string;
  surfaceId: string;
  /** Booth number, suite number — whatever the reader is looking for. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Occupier, when the booth is sold. */
  orgName: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Composed output — what a renderer consumes
// ─────────────────────────────────────────────────────────────────────────────

export type ComposedEntry = DirectoryEntry & {
  departments: string[];
  classes: string[];
  /** Off-taxonomy category values — surfaced so print never silently misfiles. */
  unrecognizedCategories: string[];
};

export type ComposedSection =
  | { type: "listings"; title: string; groups: Array<{ heading: string | null; entries: ComposedEntry[] }> }
  | { type: "category_index"; title: string; departments: Array<{ department: string; entries: ComposedEntry[] }> }
  | { type: "booth_index"; title: string; booths: Array<{ booth: string; entry: ComposedEntry }> }
  | { type: "map"; title: string; surfaces: Array<{ surface: SurfaceForPublication; placements: PlacedThing[] }> }
  | { type: "static"; title: string; body: string };

export type ComposedPublication = {
  id: string;
  title: string;
  sections: ComposedSection[];
  /** Every entry the selection kept, ordered by name. */
  entries: ComposedEntry[];
  /** Honest reporting — never silently drop anything. */
  notes: {
    totalCandidates: number;
    excludedByDepartment: number;
    excludedAsNotPrintReady: number;
    /** Entries with no listable department: absent from the category index. */
    uncategorized: string[];
    /** Off-taxonomy values found, needing a human re-map. */
    unrecognizedCategories: string[];
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Compose
// ─────────────────────────────────────────────────────────────────────────────

const byName = (a: ComposedEntry, b: ComposedEntry) => a.orgName.localeCompare(b.orgName);

/** Numeric where possible ("7" before "101"), lexical otherwise. */
export function compareBoothNumbers(a: string, b: string): number {
  const na = Number(a); const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Turn a definition plus its rows into ordered, renderable sections.
 *
 * Nothing is dropped quietly: everything the selection excludes, every entry
 * with no department, and every off-taxonomy value is counted in `notes`. A
 * publication that silently omits a paying exhibitor is worse than one that
 * prints a thin listing, and on paper the mistake is permanent.
 */
export function composePublication(
  publication: Publication,
  entries: DirectoryEntry[],
  surfaces: SurfaceForPublication[] = [],
  placements: PlacedThing[] = []
): ComposedPublication {
  // Scope first, so `totalCandidates` describes this publication rather than
  // reporting every org in the database as "excluded".
  const scoped = publication.selection.orgIds?.length
    ? entries.filter((e) => publication.selection.orgIds!.includes(e.orgId))
    : entries;

  const composed: ComposedEntry[] = scoped.map((e) => {
    const cats = parseOrgCategories(e.rawCategories);
    return { ...e, departments: cats.departments, classes: cats.classes, unrecognizedCategories: cats.unrecognized };
  });

  const wanted = publication.selection.departments?.filter(Boolean) ?? [];
  let excludedByDepartment = 0;
  let excludedAsNotPrintReady = 0;

  const kept = composed.filter((e) => {
    if (wanted.length > 0 && !e.departments.some((d) => wanted.includes(d))) {
      excludedByDepartment++;
      return false;
    }
    if (publication.selection.printReadyOnly && !e.completeness.isPrintReady) {
      excludedAsNotPrintReady++;
      return false;
    }
    return true;
  }).sort(byName);

  const sections = publication.sections.map((section): ComposedSection => {
    switch (section.type) {
      case "listings":
        return { type: "listings", title: section.title ?? "Listings", groups: buildListingGroups(kept, section.groupBy) };
      case "category_index":
        return { type: "category_index", title: section.title ?? "By Category", departments: buildCategoryIndex(kept) };
      case "booth_index":
        return { type: "booth_index", title: section.title ?? "By Booth", booths: buildBoothIndex(kept) };
      case "map": {
        const chosen = section.surfaceId ? surfaces.filter((s) => s.id === section.surfaceId) : surfaces;
        return {
          type: "map",
          title: section.title ?? "Map",
          // Each surface carries only its own placements — a map page is one
          // coordinate space, and mixing floors would draw booths off-plan.
          surfaces: [...chosen]
            .sort((a, b) => a.level - b.level)
            .map((surface) => ({
              surface,
              placements: placements
                .filter((p) => p.surfaceId === surface.id)
                .sort((a, b) => compareBoothNumbers(a.label, b.label)),
            })),
        };
      }
      case "static":
        return { type: "static", title: section.title, body: section.body };
    }
  });

  return {
    id: publication.id,
    title: publication.title,
    sections,
    entries: kept,
    notes: {
      totalCandidates: scoped.length,
      excludedByDepartment,
      excludedAsNotPrintReady,
      uncategorized: kept.filter((e) => e.departments.length === 0).map((e) => e.orgName),
      unrecognizedCategories: [...new Set(kept.flatMap((e) => e.unrecognizedCategories))].sort(),
    },
  };
}

/**
 * Group listings. `category` repeats an entry under every department it serves —
 * a reader looking under "Apparel" should find everyone who sells apparel, not
 * only those whose first-listed category happened to be it.
 */
function buildListingGroups(
  entries: ComposedEntry[],
  groupBy: "category" | "name" | "booth"
): Array<{ heading: string | null; entries: ComposedEntry[] }> {
  if (groupBy === "name") return [{ heading: null, entries: [...entries].sort(byName) }];

  if (groupBy === "booth") {
    const withBooths = entries
      .flatMap((e) => e.boothNumbers.map((b) => ({ booth: b, entry: e })))
      .sort((a, b) => compareBoothNumbers(a.booth, b.booth));
    return [{ heading: null, entries: withBooths.map((r) => r.entry) }];
  }

  const groups = NACS_DEPARTMENTS
    .map((dept) => ({ heading: dept, entries: entries.filter((e) => e.departments.includes(dept)).sort(byName) }))
    .filter((g) => g.entries.length > 0);

  // Anyone with no listable department still gets printed — under a heading that
  // says so, rather than being dropped out of the only section that lists people.
  const orphans = entries.filter((e) => e.departments.length === 0).sort(byName);
  return orphans.length > 0 ? [...groups, { heading: "Uncategorized", entries: orphans }] : groups;
}

function buildCategoryIndex(entries: ComposedEntry[]): Array<{ department: string; entries: ComposedEntry[] }> {
  return NACS_DEPARTMENTS
    .map((department) => ({ department, entries: entries.filter((e) => e.departments.includes(department)).sort(byName) }))
    .filter((d) => d.entries.length > 0);
}

function buildBoothIndex(entries: ComposedEntry[]): Array<{ booth: string; entry: ComposedEntry }> {
  return entries
    .flatMap((entry) => entry.boothNumbers.map((booth) => ({ booth, entry })))
    .sort((a, b) => compareBoothNumbers(a.booth, b.booth));
}
