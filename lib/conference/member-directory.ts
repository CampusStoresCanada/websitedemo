import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseOrgCategories } from "@/lib/publication/categories";
import type { DirectoryListing } from "./member-directory-filter";

export type { DirectoryListing } from "./member-directory-filter";

/**
 * Who is exhibiting, browsable.
 *
 * The map's other half: the map answers "where is this company", this answers
 * "who sells lanyards". Same source of truth — orgs holding a real booth in
 * `entity_balances`, the line getConfirmedExhibitors already draws — plus the
 * booth numbers, so a reader can move from a card straight to the floor.
 *
 * Categories come from `primary_category` parsed against the NACS taxonomy,
 * never `nacs_department`: the first is the controlled vocabulary an org
 * chose, the second is an AI guess. Filtering a directory by a guess would
 * put a company in a department nobody put them in.
 */

/** Exactly what the select above returns; PostgREST cannot infer a runtime string. */
type BalanceRow = {
  entity: { kind: string; name: string } | { kind: string; name: string }[] | null;
  organizations:
    | { id: string; name: string; slug: string | null; logo_url: string | null;
        company_description: string | null; primary_category: string | null }
    | Array<{ id: string; name: string; slug: string | null; logo_url: string | null;
        company_description: string | null; primary_category: string | null }>
    | null;
};

export type MemberDirectory = {
  listings: DirectoryListing[];
  /** Every department actually represented, for the filter chips. */
  departments: string[];
};

/** "10" before "9" is wrong on a floor; compare numerically when both are numbers. */
function compareBooths(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export async function loadMemberDirectory(conferenceId: string): Promise<MemberDirectory> {
  const db = createAdminClient();
  const { data } = (await db
    .from("entity_balances")
    .select(
      "entity:conference_entities!entity_balances_entity_id_fkey(kind, name), " +
      "organizations(id, name, slug, logo_url, company_description, primary_category)"
    )
    .eq("conference_id", conferenceId)) as unknown as { data: BalanceRow[] | null };

  const byOrg = new Map<string, DirectoryListing>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    if (entity?.kind !== "booth") continue;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org) continue;

    const existing = byOrg.get(org.id);
    if (existing) {
      // An org with several booths is one listing with several numbers.
      if (entity.name && !existing.booths.includes(entity.name)) existing.booths.push(entity.name);
      continue;
    }
    byOrg.set(org.id, {
      orgId: org.id,
      name: org.name,
      slug: org.slug ?? null,
      logoUrl: org.logo_url ?? null,
      description: org.company_description ?? null,
      booths: entity.name ? [entity.name] : [],
      departments: parseOrgCategories(org.primary_category).departments,
      classes: parseOrgCategories(org.primary_category).classes,
      // Person search needs consented names; none exist yet, so this is empty
      // by construction until the directory-consent ask goes out.
      people: [],
    });
  }

  const listings = [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const l of listings) l.booths.sort(compareBooths);

  const departments = [...new Set(listings.flatMap((l) => l.departments))].sort();
  return { listings, departments };
}
