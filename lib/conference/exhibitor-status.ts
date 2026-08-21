/**
 * Exhibitor status — "does this org hold a booth, and which one?"
 *
 * Deliberately independent of the conference-attendance resolution in
 * app/org/[slug]/page.tsx, which is gated behind a logged-in viewer. Booth
 * ownership is public information: the floor plan at
 * /conference/[year]/[edition]/floor-plan is public by design and already
 * shows which org sits in each booth, so gating the same fact on the org's
 * own profile would protect nothing.
 *
 * Safety comes from the status filter instead — only conferences in
 * VISIBLE_CONFERENCE_STATUSES are reported, so a draft conference's booth
 * sales never leak onto a public profile.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";

/** Public path to the conference mark used as the Exhibitor badge icon. */
export const EXHIBITOR_BADGE_LOGO = "/logos/conference-2027-mark.svg";

export type ExhibitorStatus = {
  conferenceId: string;
  conferenceName: string;
  year: number;
  editionCode: string;
  /**
   * Booth numbers held, ascending. A booth entity's `name` IS its number
   * ("402", "7") — the `number` attribute exists on the type but is null for
   * every booth in the catalogue, which is why the floor plan card already
   * falls back to `name`.
   */
  boothNumbers: string[];
  /** Public floor plan for the conference these booths belong to. */
  floorPlanHref: string;
};

type BalanceRow = {
  entity: { name: string; kind: string } | { name: string; kind: string }[] | null;
  conference:
    | { id: string; name: string; year: number; edition_code: string; start_date: string | null; status: string }
    | Array<{ id: string; name: string; year: number; edition_code: string; start_date: string | null; status: string }>
    | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Numeric where possible ("7" before "101"), lexical otherwise. */
function compareBoothNumbers(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Booths this org holds for its current conference — nearest upcoming, else
 * most recently past, matching how the org profile picks a "current"
 * conference elsewhere. Returns null when the org holds no booth in any
 * publicly visible conference.
 */
const BALANCE_SELECT =
  "organization_id, entity:conference_entities!entity_balances_entity_id_fkey(name, kind), conference:conference_instances!entity_balances_conference_id_fkey(id, name, year, edition_code, start_date, status)";

/**
 * Collapse one org's booth balance rows into a single ExhibitorStatus for its
 * "current" conference — nearest upcoming, else most recently past, matching
 * how the org profile picks a current conference elsewhere.
 */
function resolveCurrent(rows: BalanceRow[]): ExhibitorStatus | null {
  const byConference = new Map<string, { conference: ExhibitorStatus; start: number }>();

  for (const row of rows) {
    const entity = one(row.entity);
    const conference = one(row.conference);
    if (entity?.kind !== "booth" || !conference) continue;
    if (!VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number])) {
      continue;
    }

    const existing = byConference.get(conference.id);
    if (existing) {
      existing.conference.boothNumbers.push(entity.name);
      continue;
    }
    const start = conference.start_date ? new Date(conference.start_date).getTime() : NaN;
    byConference.set(conference.id, {
      start: Number.isFinite(start) ? start : NaN,
      conference: {
        conferenceId: conference.id,
        conferenceName: conference.name,
        year: conference.year,
        editionCode: conference.edition_code,
        boothNumbers: [entity.name],
        floorPlanHref: `/conference/${conference.year}/${conference.edition_code}/floor-plan`,
      },
    });
  }

  if (byConference.size === 0) return null;

  const entries = [...byConference.values()];
  const now = Date.now();
  const dated = entries.filter((e) => Number.isFinite(e.start));
  const upcoming = dated.filter((e) => e.start >= now).sort((a, b) => a.start - b.start);
  const latestPast = dated.filter((e) => e.start < now).sort((a, b) => b.start - a.start);
  const chosen = upcoming[0] ?? latestPast[0] ?? entries[0];

  // De-dupe: an org can hold the same booth entity across more than one
  // balance row (e.g. a re-mint after a booth move), and the same number
  // should never render twice.
  chosen.conference.boothNumbers = [...new Set(chosen.conference.boothNumbers)].sort(
    compareBoothNumbers
  );
  return chosen.conference;
}

/**
 * Booths this org holds for its current conference. Returns null when the org
 * holds no booth in any publicly visible conference.
 */
export async function getExhibitorStatusForOrg(
  organizationId: string
): Promise<ExhibitorStatus | null> {
  const { data, error } = await createAdminClient()
    .from("entity_balances")
    .select(BALANCE_SELECT)
    .eq("organization_id", organizationId);

  if (error || !data) return null;
  return resolveCurrent(data as unknown as BalanceRow[]);
}

/**
 * Batch version for list views (the partners directory) — one query for every
 * org rather than one per row. Booth counts are small (tens), so this loads
 * the whole set and groups in memory.
 */
export async function getExhibitorStatusByOrg(): Promise<Map<string, ExhibitorStatus>> {
  const { data, error } = await createAdminClient()
    .from("entity_balances")
    .select(BALANCE_SELECT)
    .not("organization_id", "is", null);

  const out = new Map<string, ExhibitorStatus>();
  if (error || !data) return out;

  const rowsByOrg = new Map<string, BalanceRow[]>();
  for (const row of data as unknown as Array<BalanceRow & { organization_id: string | null }>) {
    if (!row.organization_id) continue;
    const bucket = rowsByOrg.get(row.organization_id);
    if (bucket) bucket.push(row);
    else rowsByOrg.set(row.organization_id, [row]);
  }

  for (const [orgId, rows] of rowsByOrg) {
    const status = resolveCurrent(rows);
    if (status) out.set(orgId, status);
  }
  return out;
}
