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
  /**
   * Every active org of a type — a standing member or partner directory.
   *
   * "Active" means `membership_status = 'active'`, not merely un-archived.
   * `includeInactive` exists for lapsed-member reporting; a directory should
   * never set it, because a printed book cannot un-list someone who left.
   */
  | { kind: "organizations"; orgType: string; includeInactive?: boolean };

/**
 * Stable identity for a source, so the same population is loaded once however
 * many sections draw on it.
 *
 * The network directory has four sections over three populations, and the
 * People section spans all of them — without a key, "every active partner"
 * would be queried twice and the two results could disagree mid-render.
 */
export function sourceKey(source: PublicationSource): string {
  return source.kind === "conference"
    ? `conference:${source.conferenceId}`
    : `organizations:${source.orgType}:${source.includeInactive ? "all" : "active"}`;
}

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
  /**
   * An organisation appears in the FIRST section that claims it, not in every
   * section it qualifies for.
   *
   * Exhibitors are a subset of partners, so without this the network directory
   * prints every exhibiting partner twice — once in full, once compact, pages
   * apart. With it, the Exhibitors section takes them and the Partners section
   * lists only the partners who aren't at the show, which is what a reader
   * actually wants from that second section.
   *
   * Only listings sections claim. The indexes and the People section always see
   * everyone, because cross-referencing is the point of them.
   */
  dedupeAcrossSections?: boolean;
};

/**
 * How much of an entry a listing shows.
 *
 * The book has four audiences for the same underlying orgs, and forcing one
 * template across them is the actual mistake — not the fact that there are
 * four. An exhibitor is selling and needs the room to do it; a partner who
 * isn't at the show needs to be findable, not pitched; a member store isn't
 * selling anything at all, so what matters is where it is and who works there.
 */
export type ListingStyle =
  /** Everything: description, featured product, catalogue, booth, contact, QR. */
  | "full"
  /** Name, categories, contact, QR. For partners not exhibiting this year. */
  | "compact"
  /** Store at a glance: where it is, how to reach it, who works there. */
  | "member";

/**
 * Does this listing shape carry a QR code?
 *
 * The code resolves to a live page so a reader can reach the current version,
 * a named contact, and eventually an order. That is a SELLING affordance — it
 * belongs to exhibitors and partners. A member store is not selling to the
 * people holding this book, so a code on its listing costs paper and print for
 * nothing.
 *
 * Keyed on the listing style rather than on organisation type, so the rule
 * stays general: any publication that lists non-selling organisations gets the
 * same behaviour without knowing what CSC calls them.
 */
export const styleShowsQr = (style: ListingStyle): boolean => style !== "member";

/**
 * Advertising slots, in the three sizes a directory actually sells.
 *
 * A slot with no `imageUrl` is NOT an error — it renders as a reserved, labelled
 * box. Ad space is sold against a page count, so the book has to be layoutable
 * before anything is sold, and a slot you can see is what makes that possible.
 */
export type AdSize = "quarter" | "half" | "full";

export type PublicationAd = {
  size: AdSize;
  /** Artwork. Absent means the slot is reserved but unsold. */
  imageUrl?: string | null;
  /** Who bought it, shown as a small credit and used for the InDesign tag. */
  advertiser?: string | null;
  /** Alt text — the artwork carries the message, so it needs a description. */
  alt?: string | null;
};

export type PublicationSection =
  /** The listings themselves. */
  | {
      type: "listings";
      title?: string;
      groupBy: "category" | "name" | "booth";
      style?: ListingStyle;
      /**
       * Which population this section lists. Defaults to the publication's own
       * source, which is what a single-population directory wants; the network
       * book sets one per section.
       */
      source?: PublicationSource;
    }
  /**
   * Everyone, alphabetically, each pointing back at their organisation.
   *
   * The section that makes the book a desk reference: you remember a name and
   * not a company, and this is the only way in from that direction.
   */
  | {
      type: "people";
      title?: string;
      /**
       * Defaults to everyone in the publication — the union of every listings
       * section's population. That default IS the feature: you remember a name
       * and not a company, and this is the only way into the book from that
       * direction, so scoping it to one section would defeat it.
       */
      source?: PublicationSource;
    }
  /** Department → who's in it. The index a reader scans first. */
  | { type: "category_index"; title?: string }
  /** Booth number → who's in it. Only meaningful for a conference source. */
  | { type: "booth_index"; title?: string }
  /**
   * Advertising. Its own section rather than a property of listings: an ad is
   * bought against the book, not against a company's entry, and a full-page ad
   * has to be able to sit on a page of its own.
   */
  | { type: "ads"; title?: string; ads: PublicationAd[] }
  /** One page per surface, or a named surface. */
  | { type: "map"; title?: string; surfaceId?: string }
  /** Editorial: cover copy, a welcome letter, sponsor thanks. */
  | { type: "ads"; title: string; ads: PublicationAd[] }
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
 * The whole network in one book: exhibitors, partners, members, people.
 *
 * The four sections are four populations, not four filters on one — which is
 * why sections carry their own source. The point of the artifact is that it
 * sits on a desk and answers "who are these people, what do they sell, who do
 * I call" without a search engine, so it has to cover everyone, not just the
 * companies who bought a booth this year.
 *
 * `dedupeAcrossSections` is what keeps an exhibiting partner from appearing
 * twice: Exhibitors claims them in full, and Partners lists only the partners
 * who aren't at the show.
 */
export function networkDirectory(conferenceId: string, title: string): Publication {
  return {
    id: `network-directory-${conferenceId}`,
    title,
    // The publication-level source is the fallback for sections that don't name
    // one — here, the indexes and anything added later.
    source: { kind: "conference", conferenceId },
    selection: { dedupeAcrossSections: true },
    sections: [
      { type: "map", title: "Trade Show Floor" },
      { type: "listings", title: "Exhibitors", groupBy: "category", style: "full",
        source: { kind: "conference", conferenceId } },
      { type: "booth_index", title: "By Booth Number" },
      { type: "listings", title: "Partners", groupBy: "category", style: "compact",
        source: { kind: "organizations", orgType: "Vendor Partner" } },
      { type: "listings", title: "Member Stores", groupBy: "name", style: "member",
        source: { kind: "organizations", orgType: "Member" } },
      { type: "category_index", title: "By Category" },
      // No source: spans every population above, which is the whole reason the
      // section exists.
      { type: "people", title: "People" },
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

export type DirectoryContact = {
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
};

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
  /**
   * Permanent code behind the printed QR. Never changes once printed — see
   * organizations.public_code.
   */
  publicCode: string | null;
  /** Member | Vendor Partner | … — decides which listing shape applies. */
  orgType: string | null;
  /** Where the store is. The whole of a member listing's "at a glance". */
  city: string | null;
  province: string | null;
  website: string | null;
  /**
   * The organisation's own public-record contact — publishable only because an
   * admin affirmed it as such. Null when never affirmed, which is every row
   * until someone does: `organizations.email` and `.phone` were collected as
   * "how do we reach you" and are a named person's details in 102 of 110 cases,
   * so they cannot be printed on the strength of existing data.
   */
  publicEmail: string | null;
  publicPhone: string | null;
  orgPhone: string | null;
  /**
   * What kind of institution, from the latest benchmarking response —
   * College | Polytechnic | University. Present for the ~37 of 52 members who
   * answered the survey; absent for partners entirely.
   *
   * NOT `organizations.institution_type`, which is an empty legacy column.
   */
  institutionType: string | null;
  /** Headcount the member is billed on. Every active member has one. */
  fte: number | null;
  /**
   * Someone a reader can actually contact. The printed page is frozen; a name
   * and a number are what make it actionable months later.
   */
  primaryContact: DirectoryContact | null;
  /**
   * Everyone listable at this org, for the People section. Already filtered by
   * lib/contacts/directory.ts, so anyone who asked not to be listed, or who has
   * left, is absent — which matters more on paper than on screen, because print
   * cannot be corrected after the fact.
   */
  contacts: DirectoryContact[];
  /**
   * Inline SVG QR pointing at /e/<publicCode>. Attached by attachQrCodes()
   * rather than generated in the renderer, because the renderer must stay
   * synchronous — it is also driven by renderToStaticMarkup.
   */
  qrSvg?: string | null;
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

/** One person, with the org they belong to. */
export type ComposedPerson = {
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  orgName: string;
  /** Cross-reference target — the org's permanent code, never a page number. */
  orgCode: string | null;
};

export type ComposedSection =
  | { type: "listings"; title: string; style: ListingStyle; groups: Array<{ heading: string | null; entries: ComposedEntry[] }> }
  | { type: "people"; title: string; people: ComposedPerson[] }
  | { type: "category_index"; title: string; departments: Array<{ department: string; entries: ComposedEntry[] }> }
  | { type: "booth_index"; title: string; booths: Array<{ booth: string; entry: ComposedEntry }> }
  | { type: "map"; title: string; surfaces: Array<{ surface: SurfaceForPublication; placements: PlacedThing[] }> }
  | { type: "ads"; title: string; ads: PublicationAd[] }
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
  entries: DirectoryEntry[] | ReadonlyMap<string, DirectoryEntry[]>,
  surfaces: SurfaceForPublication[] = [],
  placements: PlacedThing[] = []
): ComposedPublication {
  // An array means "one population, every section" — the shape a conference
  // directory or a single-org proof wants, and not worth a Map of one entry.
  // A Map is keyed by sourceKey() and is what the multi-section book passes.
  const bySource: ReadonlyMap<string, DirectoryEntry[]> | null =
    entries instanceof Map ? entries : null;
  const single = bySource ? null : (entries as DirectoryEntry[]);

  let excludedByDepartment = 0;
  let excludedAsNotPrintReady = 0;
  let totalCandidates = 0;

  // Memoised per source: the People section and the indexes read the same
  // populations the listings do, and filtering them repeatedly would multiply
  // the exclusion counts into fiction.
  const prepared = new Map<string, ComposedEntry[]>();

  function prepareFor(source: PublicationSource): ComposedEntry[] {
    const key = sourceKey(source);
    const hit = prepared.get(key);
    if (hit) return hit;

    const raw = bySource ? (bySource.get(key) ?? []) : single!;

    // Scope first, so `totalCandidates` describes this publication rather than
    // reporting every org in the database as "excluded".
    const scoped = publication.selection.orgIds?.length
      ? raw.filter((e) => publication.selection.orgIds!.includes(e.orgId))
      : raw;
    totalCandidates += scoped.length;

    const composed: ComposedEntry[] = scoped.map((e) => {
      const cats = parseOrgCategories(e.rawCategories);
      return { ...e, departments: cats.departments, classes: cats.classes, unrecognizedCategories: cats.unrecognized };
    });

    const wanted = publication.selection.departments?.filter(Boolean) ?? [];
    const kept = composed
      .filter((e) => {
        if (wanted.length > 0 && !e.departments.some((d) => wanted.includes(d))) {
          excludedByDepartment++;
          return false;
        }
        if (publication.selection.printReadyOnly && !e.completeness.isPrintReady) {
          excludedAsNotPrintReady++;
          return false;
        }
        return true;
      })
      .sort(byName);

    prepared.set(key, kept);
    return kept;
  }

  // Every population this publication draws on, prepared up front so the
  // indexes can span all of them regardless of section order.
  const listingSections = publication.sections.filter((s) => s.type === "listings");
  const sourcesUsed =
    listingSections.length > 0
      ? listingSections.map((s) => s.source ?? publication.source)
      : [publication.source];

  const everyone: ComposedEntry[] = [];
  const seen = new Set<string>();
  for (const source of sourcesUsed) {
    for (const entry of prepareFor(source)) {
      // An exhibiting partner is in two populations and is still one company.
      if (seen.has(entry.orgId)) continue;
      seen.add(entry.orgId);
      everyone.push(entry);
    }
  }
  everyone.sort(byName);

  // Claimed by an earlier listings section — see `dedupeAcrossSections`.
  const claimed = new Set<string>();

  /**
   * Entries that visibly print under an "Uncategorized" heading.
   *
   * Deliberately not "every entry with no department": a member store has no
   * NACS categories because it doesn't sell anything, and its section lists by
   * name, so it never appears under that heading. Counting it as a gap made the
   * warning 52 false positives deep and buried the handful of partners who
   * genuinely haven't picked a category — which is the one thing the warning
   * exists to surface.
   */
  const printedUncategorized = new Map<string, string>();

  const sections = publication.sections.map((section): ComposedSection => {
    switch (section.type) {
      case "listings": {
        let list = prepareFor(section.source ?? publication.source);
        if (publication.selection.dedupeAcrossSections) {
          list = list.filter((e) => !claimed.has(e.orgId));
          for (const e of list) claimed.add(e.orgId);
        }
        if (section.groupBy === "category") {
          for (const e of list) {
            if (e.departments.length === 0) printedUncategorized.set(e.orgId, e.orgName);
          }
        }
        return {
          type: "listings",
          title: section.title ?? "Listings",
          style: section.style ?? "full",
          groups: buildListingGroups(list, section.groupBy),
        };
      }
      case "people": {
        const people = section.source ? prepareFor(section.source) : everyone;
        return { type: "people", title: section.title ?? "People", people: buildPeopleIndex(people) };
      }
      case "category_index":
        return { type: "category_index", title: section.title ?? "By Category", departments: buildCategoryIndex(everyone) };
      case "booth_index":
        return { type: "booth_index", title: section.title ?? "By Booth", booths: buildBoothIndex(everyone) };
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
      case "ads":
        return { type: "ads", title: section.title ?? "Advertising", ads: section.ads };
      case "static":
        return { type: "static", title: section.title, body: section.body };
    }
  });

  return {
    id: publication.id,
    title: publication.title,
    sections,
    entries: everyone,
    notes: {
      totalCandidates,
      excludedByDepartment,
      excludedAsNotPrintReady,
      uncategorized: [...printedUncategorized.values()].sort(),
      unrecognizedCategories: [...new Set(everyone.flatMap((e) => e.unrecognizedCategories))].sort(),
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

/**
 * Every listable person, alphabetically by surname-ish (last word of the name),
 * each carrying its org's code so InDesign can build a real cross-reference.
 *
 * Page numbers are deliberately NOT emitted: InDesign paginates, and any number
 * we produced would be wrong the moment a margin changed. The stable identity
 * is the org code; turning that into "see p. 14" is the layout tool's job.
 */
function buildPeopleIndex(entries: ComposedEntry[]): ComposedPerson[] {
  const people: ComposedPerson[] = [];
  for (const entry of entries) {
    for (const contact of entry.contacts) {
      people.push({
        name: contact.name,
        roleTitle: contact.roleTitle,
        email: contact.email,
        phone: contact.phone,
        orgName: entry.orgName,
        orgCode: entry.publicCode,
      });
    }
  }
  const sortKey = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return `${parts.at(-1) ?? ""} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
  };
  return people.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)) || a.orgName.localeCompare(b.orgName));
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

/**
 * The organisation's own contact details, but only once affirmed as a public
 * record.
 *
 * `organizations.email` and `.phone` were collected as "how do we reach you"
 * and hold a named person's details in 102 of 110 rows. Printing one as a
 * company contact would route around the per-person consent gate through a
 * different column, so the value alone is never enough — the affirmation is
 * what makes it publishable.
 *
 * A function rather than an inline ternary because the last consent filter
 * that lived inline was computed and never read, and shipped an unconsented
 * name onto a page. This one is exercised by tests.
 */
export function publishablePublicContact(org: {
  email?: string | null;
  phone?: string | null;
  public_contact_confirmed_at?: string | null;
}): { publicEmail: string | null; publicPhone: string | null } {
  if (!org.public_contact_confirmed_at) return { publicEmail: null, publicPhone: null };
  return {
    publicEmail: org.email?.trim() || null,
    publicPhone: org.phone?.trim() || null,
  };
}
