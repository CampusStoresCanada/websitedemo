/**
 * How many people a capped thing will actually admit — and how many turned up.
 *
 * ⛔ **Seats sold is the wrong denominator.** A day pass *includes* the evening
 * event on the eve of its day: a Tuesday pass admits you to the Meet & Greet, a
 * Thursday pass to the Wednesday Offsite. Both of those are capped at 160 and
 * sold at $99 — so counting `entity_balance_seats` against the cap misses every
 * day-pass holder, who never bought a seat on the event and is coming anyway.
 *
 * The right number is everyone whose ACCESS CLOSURE reaches the entity, which is
 * the same `resolveAccess` walk a door would run. That is the point: a day pass
 * getting in only on its day, and a capped reception admitting only its holders,
 * are one question asked of one graph — not two features.
 *
 * ⚠️ Expected ≠ attending. Somebody entitled to a reception may skip it. This is
 * a ceiling and a catering planning number, not a prediction. `scanned` is the
 * only count that says who was in the room, and it stays 0 until a door exists.
 *
 * ## The chain, and why the seat is the ticket
 *
 * purchase → balance → **seat** → assignment to a person → access closure.
 *
 * A seat IS the ticket, and assigning it to a person is how the ticket gets
 * given. 📏 Verified on the live roster: John Wikle holds one Exhibitor Staff
 * Registration seat and his closure resolves to Wed + Thu only, while a Board
 * Registration seat resolves to all four days. Every person on the conference
 * holds at least one seat — there is no badge with no ticket behind it.
 *
 * ⛔ That makes `expected` and `expectedNamed` two genuinely different numbers,
 * not a nicety:
 *   - `expected` counts **tickets that admit somebody here**, including the 166
 *     seats nobody has been named to yet. That is the catering number: those
 *     tickets are sold and somebody will use them.
 *   - `expectedNamed` counts **tickets currently in a person's hands**. That is
 *     the door number, because an unnamed seat has no person and therefore no
 *     badge — nobody can present it.
 * Today those are 165 and 13. Reporting either one as "attendance" without the
 * other would be wrong in opposite directions.
 */

import { resolveAccess } from "@/lib/conference/entity-commerce";
import { loadSeatHoldings } from "@/lib/conference/seats";
import type { BuildEntity } from "@/lib/actions/conference-entities";

export type EntityAttendance = {
  entityId: string;
  name: string;
  kind: string;
  /** The cap from the catalogue, or null when the thing is uncapped. */
  capacity: number | null;
  /** Seats sold directly on this entity — the number that used to be reported. */
  directSeats: number;
  /**
   * Everyone whose access closure reaches it: direct seat holders plus everybody
   * admitted through something else they hold. The number a caterer needs.
   */
  expected: number;
  /** How many of those have a person named to the seat. */
  expectedNamed: number;
  /** Scans recorded at this entity. 0 until a door surface exists. */
  scanned: number;
  /** expected − capacity when over, else 0. */
  over: number;
};

/**
 * Attendance for every capped or separately-sold thing in a conference.
 *
 * Uncapped, unsold things are skipped: a Keynote everybody is admitted to is not
 * a number anybody has to manage, and listing all 60 booths and 18 meals would
 * bury the three lines that matter.
 */
export async function loadAttendance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  conferenceId: string
): Promise<EntityAttendance[]> {
  const { seats, entitiesById } = await loadSeatHoldings(db, { conferenceId });

  // ⛔ One closure PER SEAT-HOLDING SET, not per seat. Somebody holding a
  // registration and a separately-bought reception seat must be counted once at
  // that reception, not twice.
  const heldByPerson = new Map<string, string[]>();
  const unassigned: string[][] = [];
  for (const seat of seats) {
    if (seat.holderPersonId) {
      const list = heldByPerson.get(seat.holderPersonId) ?? [];
      if (!list.includes(seat.entityId)) list.push(seat.entityId);
      heldByPerson.set(seat.holderPersonId, list);
    } else {
      // ⚠️ An unnamed seat is still a person who will be in the room — the name
      // just is not in yet. Counted, but kept separable via expectedNamed, so a
      // caterer can see how much of the number is still hypothetical.
      unassigned.push([seat.entityId]);
    }
  }

  const namedReach = [...heldByPerson.values()].map((held) => resolveAccess(held, entitiesById));
  const unnamedReach = unassigned.map((held) => resolveAccess(held, entitiesById));

  const directSeatCount = new Map<string, number>();
  for (const seat of seats) {
    directSeatCount.set(seat.entityId, (directSeatCount.get(seat.entityId) ?? 0) + 1);
  }

  const { data: scanRows } = await db
    .from("conference_check_in_events")
    .select("entity_id")
    .eq("conference_id", conferenceId)
    .eq("result_state", "valid")
    .not("entity_id", "is", null);
  const scanCount = new Map<string, number>();
  for (const row of (scanRows ?? []) as Array<{ entity_id: string | null }>) {
    if (!row.entity_id) continue;
    scanCount.set(row.entity_id, (scanCount.get(row.entity_id) ?? 0) + 1);
  }

  const out: EntityAttendance[] = [];
  for (const entity of entitiesById.values()) {
    const capacity = capacityOf(entity);
    const direct = directSeatCount.get(entity.id) ?? 0;
    const expectedNamed = namedReach.filter((reach) => reach.has(entity.id)).length;
    const expected =
      expectedNamed + unnamedReach.filter((reach) => reach.has(entity.id)).length;
    // ⛔ Nobody expected and nothing sold — drop it. This is what keeps 60 empty
    // booths (each capped at 1) out of an attendance report, WITHOUT the report
    // knowing the word "booth". Filtering by entity kind would put this
    // conference's vocabulary into a general tool; filtering by "no people"
    // says the same thing and stays true for a conference that caps something
    // nobody here has thought of.
    if (expected === 0 && direct === 0) continue;
    out.push({
      entityId: entity.id,
      name: entity.name,
      kind: entity.kind,
      capacity,
      directSeats: direct,
      expected,
      expectedNamed,
      scanned: scanCount.get(entity.id) ?? 0,
      over: capacity !== null && expected > capacity ? expected - capacity : 0,
    });
  }

  // ⛔ CAPPED things first, then over-capacity, then size.
  //
  // Sorting by headcount alone buries the three lines that matter: every meal
  // everybody is admitted to reports ~165, and the capped $99 receptions report
  // 14, so the rows a human has to manage sink below the rows that manage
  // themselves. A cap is the signal that somebody owns this number.
  return out.sort(
    (a, b) =>
      Number(b.capacity !== null) - Number(a.capacity !== null) ||
      b.over - a.over ||
      b.expected - a.expected ||
      a.name.localeCompare(b.name)
  );
}

/**
 * The cap, from wherever the catalogue keeps it.
 *
 * ⚠️ `inventory` is untyped JSON on the entity, so it arrives as a number, a
 * numeric string, or an object. A cap read wrong is worse than no cap — it would
 * report a room as fine when it is not — so anything unrecognised returns null
 * (uncapped) rather than a guess.
 */
function capacityOf(entity: BuildEntity): number | null {
  const raw: unknown = entity.inventory;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  if (raw && typeof raw === "object") {
    const cap = (raw as Record<string, unknown>).capacity ?? (raw as Record<string, unknown>).total;
    if (typeof cap === "number" && Number.isFinite(cap)) return cap;
  }
  return null;
}
