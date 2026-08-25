/**
 * Reading and writing saved publication definitions.
 *
 * `selection` and `sections` are jsonb, so the database cannot enforce their
 * shape. That makes parsing the load-bearing part of this file: a definition
 * comes back from storage as `unknown`, and anything malformed has to be caught
 * here rather than surfacing as a missing page in something already at press.
 *
 * The rule the rest of the system follows applies here too — **nothing is
 * dropped silently**. A section that fails validation is reported in
 * `rejected`, so an admin sees "this section was ignored and why" instead of
 * discovering a directory that quietly printed without its booth index.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Publication,
  PublicationAd,
  PublicationSection,
  PublicationSelection,
  PublicationSource,
} from "./composition";

export type ParsedPublication = {
  publication: Publication;
  /** Human-readable reasons any part of the stored definition was ignored. */
  rejected: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

function parseSource(raw: unknown, rejected: string[]): PublicationSource | null {
  if (!isRecord(raw)) {
    rejected.push("source is not an object");
    return null;
  }
  if (raw.kind === "conference") {
    const id = str(raw.conferenceId);
    if (!id) {
      rejected.push("conference source has no conferenceId");
      return null;
    }
    return { kind: "conference", conferenceId: id };
  }
  if (raw.kind === "organizations") {
    const orgType = str(raw.orgType);
    if (!orgType) {
      rejected.push("organizations source has no orgType");
      return null;
    }
    return {
      kind: "organizations",
      orgType,
      // Only an explicit `true` opts in — a malformed value must not silently
      // widen a directory to include lapsed organisations.
      includeInactive: raw.includeInactive === true ? true : undefined,
    };
  }
  rejected.push(`unknown source kind: ${JSON.stringify(raw.kind)}`);
  return null;
}

function parseSelection(raw: unknown, rejected: string[]): PublicationSelection {
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) {
    rejected.push("selection is not an object — treated as empty");
    return {};
  }
  const selection: PublicationSelection = {};
  if (Array.isArray(raw.orgIds)) selection.orgIds = raw.orgIds.filter((v): v is string => typeof v === "string");
  if (Array.isArray(raw.departments)) selection.departments = raw.departments.filter((v): v is string => typeof v === "string");
  if (typeof raw.printReadyOnly === "boolean") selection.printReadyOnly = raw.printReadyOnly;
  if (typeof raw.dedupeAcrossSections === "boolean") selection.dedupeAcrossSections = raw.dedupeAcrossSections;
  return selection;
}

/**
 * One section. Returns null (with a reason) rather than a partial section: a
 * listings block with no `groupBy` would print in an arbitrary order, which is
 * worse than an admin being told it was ignored.
 */
function parseSection(raw: unknown, index: number, rejected: string[]): PublicationSection | null {
  if (!isRecord(raw)) {
    rejected.push(`section ${index} is not an object`);
    return null;
  }
  const title = str(raw.title) ?? undefined;

  /**
   * A section's own source, when it has one.
   *
   * Absent is fine — it means "use the publication's". A present-but-invalid
   * one is not: falling back would print a whole section of the wrong
   * population under a heading claiming otherwise, which on paper is
   * unrecoverable. So it rejects the section instead.
   */
  let sectionSource: PublicationSource | undefined;
  if (raw.source !== undefined && raw.source !== null) {
    const parsed = parseSource(raw.source, rejected);
    if (!parsed) {
      rejected.push(`section ${index} has an invalid source and was ignored`);
      return null;
    }
    sectionSource = parsed;
  }

  switch (raw.type) {
    case "listings": {
      const groupBy = raw.groupBy;
      if (groupBy !== "category" && groupBy !== "name" && groupBy !== "booth") {
        rejected.push(`section ${index} (listings) has invalid groupBy: ${JSON.stringify(groupBy)}`);
        return null;
      }
      const style = raw.style;
      if (style !== undefined && style !== "full" && style !== "compact" && style !== "member") {
        rejected.push(`section ${index} (listings) has invalid style: ${JSON.stringify(style)}`);
        return null;
      }
      return { type: "listings", title, groupBy, style, source: sectionSource };
    }
    case "people":
      return { type: "people", title, source: sectionSource };
    case "ads": {
      if (!Array.isArray(raw.ads)) {
        rejected.push(`section ${index} (ads) has no ads array`);
        return null;
      }
      const ads: PublicationAd[] = [];
      raw.ads.forEach((entry, i) => {
        if (!isRecord(entry)) {
          rejected.push(`section ${index}, ad ${i} is not an object`);
          return;
        }
        const size = entry.size;
        // A slot with an unknown size has no dimensions, so it cannot be laid
        // out at all — dropping just that slot keeps the rest of the page.
        if (size !== "quarter" && size !== "half" && size !== "full") {
          rejected.push(`section ${index}, ad ${i} has invalid size: ${JSON.stringify(size)}`);
          return;
        }
        ads.push({
          size,
          // No imageUrl is legitimate: the slot is reserved but unsold.
          imageUrl: str(entry.imageUrl) ?? null,
          advertiser: str(entry.advertiser) ?? null,
          alt: str(entry.alt) ?? null,
        });
      });
      return { type: "ads", title, ads };
    }
    case "category_index":
      return { type: "category_index", title };
    case "booth_index":
      return { type: "booth_index", title };
    case "map":
      return { type: "map", title, surfaceId: str(raw.surfaceId) ?? undefined };
    case "static": {
      const staticTitle = str(raw.title);
      const body = str(raw.body);
      if (!staticTitle || !body) {
        rejected.push(`section ${index} (static) needs both a title and a body`);
        return null;
      }
      return { type: "static", title: staticTitle, body };
    }
    default:
      rejected.push(`section ${index} has unknown type: ${JSON.stringify(raw.type)}`);
      return null;
  }
}

export type StoredPublicationRow = {
  id: string;
  name: string;
  title: string;
  source: unknown;
  selection: unknown;
  sections: unknown;
};

/** Pure — validate a stored row into a Publication, collecting what it ignored. */
export function parsePublication(row: StoredPublicationRow): ParsedPublication | null {
  const rejected: string[] = [];
  const source = parseSource(row.source, rejected);
  if (!source) return null; // without a source there is nothing to publish

  const rawSections = Array.isArray(row.sections) ? row.sections : [];
  if (!Array.isArray(row.sections)) rejected.push("sections is not an array — treated as empty");

  const sections = rawSections
    .map((s, i) => parseSection(s, i, rejected))
    .filter((s): s is PublicationSection => s !== null);

  return {
    publication: {
      id: row.id,
      title: row.title,
      source,
      selection: parseSelection(row.selection, rejected),
      sections,
    },
    rejected,
  };
}

// ── Storage ────────────────────────────────────────────────────────────────

const SELECT = "id, name, title, source, selection, sections";

export async function listPublications(): Promise<Array<{ id: string; name: string; title: string }>> {
  const { data } = await createAdminClient()
    .from("publications")
    .select("id, name, title")
    .order("name");
  return (data ?? []) as Array<{ id: string; name: string; title: string }>;
}

export async function loadPublication(id: string): Promise<ParsedPublication | null> {
  const { data } = await createAdminClient().from("publications").select(SELECT).eq("id", id).maybeSingle();
  return data ? parsePublication(data as StoredPublicationRow) : null;
}

/** Find the saved definition for a conference, if one exists. */
export async function loadPublicationForConference(conferenceId: string): Promise<ParsedPublication | null> {
  const { data } = await createAdminClient()
    .from("publications")
    .select(SELECT)
    .eq("source->>kind", "conference")
    .eq("source->>conferenceId", conferenceId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data ? parsePublication(data as StoredPublicationRow) : null;
}

export async function savePublication(input: {
  id?: string;
  name: string;
  title: string;
  source: PublicationSource;
  selection: PublicationSelection;
  sections: PublicationSection[];
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const db = createAdminClient();
  // The typed union round-trips through JSON on the way into jsonb; the shape
  // is re-validated by parsePublication() on the way back out, which is where
  // the guarantee actually lives.
  const row = {
    name: input.name,
    title: input.title,
    source: JSON.parse(JSON.stringify(input.source)),
    selection: JSON.parse(JSON.stringify(input.selection)),
    sections: JSON.parse(JSON.stringify(input.sections)),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = input.id
    ? await db.from("publications").update(row).eq("id", input.id).select("id").maybeSingle()
    : await db.from("publications").insert(row).select("id").maybeSingle();

  if (error || !data) return { success: false, error: error?.message ?? "Could not save the publication." };
  return { success: true, id: (data as { id: string }).id };
}
