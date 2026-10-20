/**
 * How much blank stock a print run holds back for the desk.
 *
 * ⛔ Distinct from the blanks for outstanding SEATS. Those belong to a known
 * company that has not named somebody yet, and they carry that company's name,
 * logo and map. Reprint spares belong to nobody: they are stock for the desk to
 * write on when a badge is damaged, lost, or somebody walks up unregistered.
 * They carry no organisation and map the conference hotel.
 *
 * ⛔ The two populations are counted from different bases, because the risk is
 * different:
 *
 *   EXHIBITORS — a percentage of the LARGER of what the floor could hold and
 *     what has actually sold. 📏 60 booths × 4 staff registrations each = 240
 *     possible against 152 sold, so capacity wins today. Booth staff turn over
 *     between move-in and the trade show and the desk cannot ring a store to
 *     confirm a name, so early on the room is the honest estimate. But booth
 *     allocation is not a ceiling — staff registrations sell separately — so the
 *     day an exhibitor orders past their allocation, sales becomes the truth and
 *     the basis follows without anybody changing a setting.
 *
 *   MEMBERS — a percentage of the roster as it stands on print day, with a
 *     FLOOR. 📏 Today that roster is 13, so 20% is 3 — nowhere near enough to
 *     cover a desk for four days. The floor is what makes the number usable
 *     early, when a percentage of a nearly-empty roster is meaningless.
 *
 * ⚠️ Every number here is the CONFERENCE's decision, not this code's. The
 * defaults are what CSC chose for 2027; another conference with a bigger floor
 * or a later-filling roster will want different ones, and hardcoding these would
 * be the same mistake the badge scan rules already had to be rescued from.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveRefs } from "@/lib/conference/entity-graph";
import { loadSeatHoldings } from "@/lib/conference/seats";
import type { BuildEntity } from "@/lib/actions/conference-entities";
import type { BadgeRun } from "@/lib/conference/badges/run";

export type BadgePrintStock = {
  /** Percentage of the floor's total possible exhibitor staff seats. */
  exhibitorSparePercent: number;
  /** Percentage of the member roster as it stands when the run is generated. */
  memberSparePercent: number;
  /** Never fewer member spares than this, however small the roster is. */
  memberSpareMinimum: number;
  /** Off by default for a conference that has not thought about it. */
  enabled: boolean;
};

/**
 * ⛔ Spares OFF unless a conference turns them on. Silently adding a hundred
 * blank cards to somebody's print bill is not a sensible default, and a
 * conference that wants none should not have to discover a setting to say so.
 */
export const DEFAULT_BADGE_PRINT_STOCK: BadgePrintStock = {
  exhibitorSparePercent: 20,
  memberSparePercent: 20,
  memberSpareMinimum: 50,
  enabled: false,
};

function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  // ⚠️ Above 100% is a typo, not a request. Below 0 is meaningless.
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

function clampCount(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function normalizeBadgePrintStock(value: unknown): BadgePrintStock {
  if (!value || typeof value !== "object") return DEFAULT_BADGE_PRINT_STOCK;
  const raw = value as Record<string, unknown>;
  return {
    exhibitorSparePercent: clampPercent(
      raw.exhibitorSparePercent,
      DEFAULT_BADGE_PRINT_STOCK.exhibitorSparePercent
    ),
    memberSparePercent: clampPercent(
      raw.memberSparePercent,
      DEFAULT_BADGE_PRINT_STOCK.memberSparePercent
    ),
    memberSpareMinimum: clampCount(
      raw.memberSpareMinimum,
      DEFAULT_BADGE_PRINT_STOCK.memberSpareMinimum
    ),
    enabled: raw.enabled === true,
  };
}

/** Never throws: a print run must still produce badges if this read fails. */
export async function getBadgePrintStock(conferenceId: string): Promise<BadgePrintStock> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("conference_instances")
      .select("badge_print_stock")
      .eq("id", conferenceId)
      .maybeSingle();
    return normalizeBadgePrintStock(data?.badge_print_stock);
  } catch {
    return DEFAULT_BADGE_PRINT_STOCK;
  }
}

/**
 * Total exhibitor staff seats the floor could hold, sold or not.
 *
 * ⛔ Uses `effectiveRefs`, not `refs`. 58 of this conference's 60 booths are
 * INSTANCES of a booth type and carry no `includes` edges of their own — reading
 * raw refs reports 8 possible seats instead of 240, which would size the spare
 * pool at 2 cards.
 */
export function totalPossibleExhibitorSeats(byId: Map<string, BuildEntity>): number {
  let total = 0;
  for (const entity of byId.values()) {
    if (entity.kind !== "booth") continue;
    for (const ref of effectiveRefs(entity, byId)) {
      if (ref.role !== "includes") continue;
      if (byId.get(ref.toEntityId)?.kind !== "registration") continue;
      total += ref.quantity ?? 1;
    }
  }
  return total;
}

/**
 * The registration types booths hand out — the exhibitor side of the catalogue.
 *
 * ⛔ Derived from the booth graph rather than from a name or an org type, so it
 * stays correct for a conference whose exhibitor registration is called
 * something else. Whatever a booth includes IS an exhibitor seat here.
 */
export function exhibitorRegistrationIds(byId: Map<string, BuildEntity>): Set<string> {
  const ids = new Set<string>();
  for (const entity of byId.values()) {
    if (entity.kind !== "booth") continue;
    for (const ref of effectiveRefs(entity, byId)) {
      if (ref.role !== "includes") continue;
      if (byId.get(ref.toEntityId)?.kind !== "registration") continue;
      ids.add(ref.toEntityId);
    }
  }
  return ids;
}

export type SpareCounts = {
  exhibitor: number;
  member: number;
  total: number;
  /** What each number was derived from, so an operator can check the maths. */
  basis: {
    possibleExhibitorSeats: number;
    soldExhibitorSeats: number;
    /** max(capacity, sold) — the larger is the one spares are sized against. */
    exhibitorBasis: number;
    memberRoster: number;
    minimumApplied: boolean;
  };
};

export function computeSpareCounts(params: {
  stock: BadgePrintStock;
  possibleExhibitorSeats: number;
  soldExhibitorSeats: number;
  memberRoster: number;
}): SpareCounts {
  const { stock, possibleExhibitorSeats, soldExhibitorSeats, memberRoster } = params;
  // ⛔ The basis is the LARGEST number of badges that could need reprinting,
  // which is capacity OR sales, whichever is bigger — never a fixed one.
  //
  // Booth allocation is not a ceiling: exhibitor staff registrations are sold
  // separately, so an exhibitor who wants forty-seven more badges than their
  // booths include can have them. Sizing spares on booth capacity alone would
  // hold back 20% of a number that stopped being the truth the moment they
  // ordered. Sizing on sales alone is worse in the other direction: early on,
  // sales are near zero and you cannot order stock against a number that has
  // not happened yet.
  //
  // 📏 Today capacity wins — 240 possible against 152 sold. The day an
  // exhibitor orders past their allocation, sales wins, and nobody has to
  // notice or change a setting.
  const exhibitorBasis = Math.max(possibleExhibitorSeats, soldExhibitorSeats);
  if (!stock.enabled) {
    return {
      exhibitor: 0,
      member: 0,
      total: 0,
      basis: {
        possibleExhibitorSeats,
        soldExhibitorSeats,
        exhibitorBasis,
        memberRoster,
        minimumApplied: false,
      },
    };
  }
  const exhibitor = Math.ceil((exhibitorBasis * stock.exhibitorSparePercent) / 100);
  const byPercent = Math.ceil((memberRoster * stock.memberSparePercent) / 100);
  // ⛔ "or 50, whichever is larger" — the floor wins on a small roster, which is
  // the whole point of having one.
  const member = Math.max(byPercent, stock.memberSpareMinimum);
  return {
    exhibitor,
    member,
    total: exhibitor + member,
    basis: {
      possibleExhibitorSeats,
      soldExhibitorSeats,
      exhibitorBasis,
      memberRoster,
      minimumApplied: member > byPercent,
    },
  };
}

/**
 * The three numbers the percentages are applied to, read from live data.
 *
 * ⛔ ONE implementation, two callers: the print pipeline sizing a real stack and
 * the admin screen showing an operator what their percentages come to. A second
 * copy for the preview would be a screen that confidently displays a number the
 * printer does not produce — and nobody would find out until the box arrived.
 */
export async function loadSpareBasis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  conferenceId: string,
  run: BadgeRun
): Promise<{
  possibleExhibitorSeats: number;
  soldExhibitorSeats: number;
  memberRoster: number;
}> {
  const { seats, entitiesById } = await loadSeatHoldings(db, { conferenceId });
  const exhibitorTypes = exhibitorRegistrationIds(entitiesById);
  return {
    possibleExhibitorSeats: totalPossibleExhibitorSeats(entitiesById),
    soldExhibitorSeats: seats.filter((seat) => exhibitorTypes.has(seat.entityId)).length,
    // ⚠️ People NAMED to a seat as the run stands right now — the same "roster on
    // the day we go to print" number an operator would count by hand. It grows
    // every time somebody is named, which is exactly why the floor exists.
    memberRoster: run.types.reduce(
      (sum, type) => sum + type.seats.filter((seat) => seat.person).length,
      0
    ),
  };
}

/** Spare counts for one job, from the conference's configured policy. */
export async function spareCountsForJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  conferenceId: string,
  run: BadgeRun,
  stock: BadgePrintStock
): Promise<SpareCounts> {
  return computeSpareCounts({ stock, ...(await loadSpareBasis(db, conferenceId, run)) });
}

/**
 * The spare stacks: one per BADGE LOOK, never per registration type.
 *
 * ⛔ Stephen, 2026-10-20: dealing spares out across registration types was a
 * forecast of who would lose a badge, and small types rounded to zero ("the
 * guessing was fun, but it was never gonna work"). A spare now prints with its
 * schedule area EMPTY; the desk prints the person's schedule on a sticker. So
 * a spare fits anybody whose badge looks the same — and the only thing that
 * still differs is the LOOK: the front design and colour theme of a variant
 * (resolveBadgeVariant). CSC 2027 has two: exhibitor (navy, with the company
 * QR) and delegate (red).
 *
 * The two pools keep their own bases (exhibitor % and member %) and each pool
 * splits only across the looks its types use — one stack each, almost always.
 * A conference with a third look gets a third stack without a code change.
 */
export type SpareStack = {
  /** Stable for a given catalogue and template: `${pool}:${n}`. */
  key: string;
  /** For the operator: "Delegate", "Exhibitor". */
  label: string;
  /** Every registration type this stack's cards fit. */
  typeIds: string[];
  /** The type whose variant the card is printed as (same look as the rest). */
  variantTypeId: string;
  count: number;
};

export function spareStacks(params: {
  types: ReadonlyArray<{ entityId: string; name: string; sold: number }>;
  exhibitorTypeIds: ReadonlySet<string>;
  /** Front design + colour theme of a type's badge — what a card LOOKS like. */
  lookOf: (typeId: string) => string;
  counts: { exhibitor: number; member: number };
}): SpareStack[] {
  const pools = [
    { pool: "exhibitor", label: "Exhibitor", count: params.counts.exhibitor, types: params.types.filter((t) => params.exhibitorTypeIds.has(t.entityId)) },
    { pool: "delegate", label: "Delegate", count: params.counts.member, types: params.types.filter((t) => !params.exhibitorTypeIds.has(t.entityId)) },
  ];
  const stacks: SpareStack[] = [];
  for (const pool of pools) {
    if (pool.count <= 0 || pool.types.length === 0) continue;
    const byLook = new Map<string, Array<{ entityId: string; name: string; sold: number }>>();
    for (const type of pool.types) {
      const look = params.lookOf(type.entityId);
      byLook.set(look, [...(byLook.get(look) ?? []), type]);
    }
    const looks = [...byLook.values()];
    const soldOf = (group: typeof looks[number]) => group.reduce((sum, t) => sum + t.sold, 0);
    const soldTotal = looks.reduce((sum, g) => sum + soldOf(g), 0);
    let remaining = pool.count;
    looks.forEach((group, i) => {
      // Usually one look per pool, which takes the whole count. Several looks
      // share it by seats sold (evenly if nothing has sold), remainder last.
      const count =
        i === looks.length - 1
          ? remaining
          : Math.min(remaining, Math.round(soldTotal > 0 ? (pool.count * soldOf(group)) / soldTotal : pool.count / looks.length));
      remaining -= count;
      const lead = [...group].sort((a, b) => b.sold - a.sold)[0];
      stacks.push({
        key: `${pool.pool}:${i}`,
        label: looks.length > 1 ? `${pool.label} (${lead.name})` : pool.label,
        typeIds: group.map((t) => t.entityId),
        variantTypeId: lead.entityId,
        count,
      });
    });
  }
  return stacks;
}

/**
 * The spare stacks for a conference, from its policy and badge template.
 * ⛔ ONE loader, two callers: the print run that makes the cards and the desk
 * that reaches for them. Two copies would send the desk to a stack that was
 * never printed.
 */
export async function loadSpareStacks(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  run: BadgeRun;
  stock: BadgePrintStock;
  lookOf: (typeId: string) => string;
}): Promise<SpareStack[]> {
  if (!params.stock.enabled) return [];
  const { seats, entitiesById } = await loadSeatHoldings(params.db, { conferenceId: params.conferenceId });
  const exhibitorTypeIds = exhibitorRegistrationIds(entitiesById);
  const counts = computeSpareCounts({
    stock: params.stock,
    possibleExhibitorSeats: totalPossibleExhibitorSeats(entitiesById),
    soldExhibitorSeats: seats.filter((seat) => exhibitorTypeIds.has(seat.entityId)).length,
    memberRoster: params.run.types.reduce((sum, type) => sum + type.seats.filter((seat) => seat.person).length, 0),
  });
  return spareStacks({
    types: params.run.types.map((t) => ({ entityId: t.entityId, name: t.name, sold: t.seats.length })),
    exhibitorTypeIds,
    lookOf: params.lookOf,
    counts,
  });
}
