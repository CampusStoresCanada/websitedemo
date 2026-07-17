import type { BuildEntity } from "@/lib/actions/conference-entities";
import { effectiveAttributes, effectiveRefs } from "./entity-graph";
import { zonedWallTimeToUtcIso } from "./tz";

/**
 * Derive a linear, day-grouped, nestable agenda from the v3 catalog graph —
 * the read model behind the schedule. A "thing" lands on the agenda when it
 * resolves to a Day (via its `when` chain) and is something that happens at a
 * time (has a time window, or a `when`). Structural things (booths, suites,
 * venues, audiences, days themselves) never appear as rows.
 *
 * Nesting answers "a meal that takes place during an event shows nested":
 *   1. an explicit `when` pointing at another timed thing  (Lunch → Trade Show)
 *   2. a parent that `includes` the child, same day        (Reception includes Dinner)
 *   3. time-containment on the same day                     (a break inside a show block)
 *
 * Pure: same graph in, same agenda out — so the service, the public schedule,
 * and tests all agree. Presentation (colour) lives in schedule-colors.ts.
 */

export type AgendaItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  /** Short teaser text, for list views that expand to the full description on demand. */
  summary: string | null;
  /** The resolved Day's date, `YYYY-MM-DD`. */
  dayKey: string;
  /** Wall times on that day, or null when the thing is untimed (all-day). */
  startTime: string | null;
  endTime: string | null;
  /** Absolute instants, DST-correct for the conference timezone. */
  startsAtUtc: string;
  endsAtUtc: string;
  /** `where` venue name (may be a literal "TBD"), or null. */
  locationLabel: string | null;
  /** `who` audience names — metadata for lenses, not a visibility gate here. */
  audienceNames: string[];
  /** Parent agenda row this nests under, or null at the top level. */
  parentId: string | null;
  /** 0 at the top level, +1 per nesting level. */
  depth: number;
};

/** Kinds that are catalog scaffolding, never timeline rows. */
const STRUCTURAL_KINDS = new Set([
  "day",
  "audience",
  "venue",
  "suite",
  "booth",
  "floorplan",
  "policy",
  "registration",
  "ticket",
  "equipment",
  "item",
]);

const MAX_DEPTH = 3;

function attr(
  entity: BuildEntity,
  byId: Map<string, BuildEntity>,
  key: string
): string | null {
  const v = effectiveAttributes(entity, byId)[key];
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/** Follow the `when` chain to the first Day's date. Cycle-guarded. */
function resolveDayKey(
  entity: BuildEntity,
  byId: Map<string, BuildEntity>,
  seen: Set<string> = new Set()
): string | null {
  if (seen.has(entity.id)) return null;
  seen.add(entity.id);
  if (entity.kind === "day") return attr(entity, byId, "date");
  for (const ref of effectiveRefs(entity, byId)) {
    if (ref.role !== "when") continue;
    const target = byId.get(ref.toEntityId);
    if (!target) continue;
    const dayKey = resolveDayKey(target, byId, seen);
    if (dayKey) return dayKey;
  }
  return null;
}

function durationMs(item: AgendaItem): number {
  return Date.parse(item.endsAtUtc) - Date.parse(item.startsAtUtc);
}

export function deriveAgenda(
  entities: BuildEntity[],
  timeZone: string
): AgendaItem[] {
  const byId = new Map(entities.map((e) => [e.id, e]));

  // 1. Build candidate rows.
  const items: AgendaItem[] = [];
  for (const e of entities) {
    if (STRUCTURAL_KINDS.has(e.kind)) continue;
    const dayKey = resolveDayKey(e, byId);
    if (!dayKey) continue;

    const refs = effectiveRefs(e, byId);
    const hasWhen = refs.some((r) => r.role === "when");
    const startTime = attr(e, byId, "start_time");
    const endTime = attr(e, byId, "end_time");
    if (!hasWhen && !startTime && !endTime) continue; // not a scheduled thing

    const where = refs.find((r) => r.role === "where")?.toName ?? null;
    const audienceNames = refs
      .filter((r) => r.role === "who")
      .map((r) => r.toName);

    items.push({
      id: e.id,
      kind: e.kind,
      title: e.name,
      description: attr(e, byId, "purpose") ?? attr(e, byId, "notes"),
      summary: attr(e, byId, "summary"),
      dayKey,
      startTime,
      endTime,
      startsAtUtc: zonedWallTimeToUtcIso(dayKey, startTime ?? "00:00", timeZone),
      endsAtUtc: zonedWallTimeToUtcIso(
        dayKey,
        endTime ?? startTime ?? "00:00",
        timeZone
      ),
      locationLabel: where,
      audienceNames,
      parentId: null,
      depth: 0,
    });
  }

  const candidateIds = new Set(items.map((i) => i.id));

  // 2. Choose each row's parent by the nesting priority.
  const parentOf = new Map<string, string | null>();
  for (const child of items) {
    parentOf.set(child.id, pickParent(child, items, byId, candidateIds));
  }

  // 3. Break any accidental cycles (a thing can't nest inside its descendant).
  for (const child of items) {
    const chain = new Set<string>([child.id]);
    let cursor = parentOf.get(child.id) ?? null;
    while (cursor) {
      if (chain.has(cursor)) {
        parentOf.set(child.id, null);
        break;
      }
      chain.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  // 4. Apply parent + depth, flattening anything past the visual cap.
  for (const item of items) {
    let depth = 0;
    let cursor = parentOf.get(item.id) ?? null;
    const guard = new Set<string>([item.id]);
    while (cursor && !guard.has(cursor)) {
      depth += 1;
      guard.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    if (depth > MAX_DEPTH) parentOf.set(item.id, null);
    item.parentId = parentOf.get(item.id) ?? null;
    item.depth = item.parentId ? Math.min(depth, MAX_DEPTH) : 0;
  }

  // 5. Stable order: by day, then start instant, then title.
  return items.sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
    const byStart = Date.parse(a.startsAtUtc) - Date.parse(b.startsAtUtc);
    if (byStart !== 0) return byStart;
    return a.title.localeCompare(b.title);
  });
}

function pickParent(
  child: AgendaItem,
  candidates: AgendaItem[],
  byId: Map<string, BuildEntity>,
  candidateIds: Set<string>
): string | null {
  const childEntity = byId.get(child.id);
  if (!childEntity) return null;
  const childRefs = effectiveRefs(childEntity, byId);

  // Priority 1: an explicit `when` pointing at another timed thing.
  for (const ref of childRefs) {
    if (ref.role !== "when") continue;
    if (ref.toEntityId !== child.id && candidateIds.has(ref.toEntityId)) {
      return ref.toEntityId;
    }
  }

  // Priority 2: a same-day parent that `includes` this child.
  for (const parent of candidates) {
    if (parent.id === child.id || parent.dayKey !== child.dayKey) continue;
    const parentEntity = byId.get(parent.id);
    if (!parentEntity) continue;
    const includesChild = effectiveRefs(parentEntity, byId).some(
      (r) => r.role === "includes" && r.toEntityId === child.id
    );
    if (includesChild) return parent.id;
  }

  // Priority 3: the smallest same-day block whose time strictly contains the child.
  let best: AgendaItem | null = null;
  for (const parent of candidates) {
    if (parent.id === child.id || parent.dayKey !== child.dayKey) continue;
    if (!parent.startTime || !parent.endTime || !child.startTime || !child.endTime) continue;
    const contains =
      Date.parse(parent.startsAtUtc) <= Date.parse(child.startsAtUtc) &&
      Date.parse(child.endsAtUtc) <= Date.parse(parent.endsAtUtc);
    if (!contains) continue;
    if (durationMs(parent) <= durationMs(child)) continue; // must be a real container
    if (!best || durationMs(parent) < durationMs(best)) best = parent;
  }
  return best?.id ?? null;
}
