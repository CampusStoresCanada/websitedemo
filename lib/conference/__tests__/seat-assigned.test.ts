import { describe, expect, it, vi } from "vitest";

/**
 * `seat_assigned` must sweep every entity of the same KIND the org holds.
 *
 * The named-entity version reported 12 orgs complete with zero people
 * assigned and 60 seats unfilled: the task pointed at "Exhibitor Staff
 * Registration" while they held "Connected Exhibitor Staff Registration" —
 * two independent entities, no inheritance. The shortcut "org holds none of
 * this entity, nothing to assign" was the right answer to the wrong question,
 * and it failed in the direction that costs most: a booth with nobody
 * assigned cannot be checked in on site.
 */
const NAMED = "entity-named";
const OTHER = "entity-other";
const KIND = "registration";

type Seat = { entity_id: string; holder_person_id: string | null; kind?: string };

function db(seats: Seat[], intents: { entity_id: string; intended_quantity: number; declared_against_total: number }[] = []) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const eq = (col: string, val: unknown) => { filters[col] = val; return b; };
      b.select = () => b;
      b.eq = eq;
      b.in = () => b;
      b.maybeSingle = () => {
        if (table === "conference_entities") {
          return Promise.resolve({ data: filters.id === NAMED ? { kind: KIND } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        const rows =
          table === "entity_balance_seats"
            ? seats.filter((s) => (s.kind ?? KIND) === filters["entity.kind"])
            : table === "conference_entity_usage_intents"
              ? intents
              : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return b;
    },
  };
}

const run = async (seats: Seat[], intents?: Parameters<typeof db>[1]) => {
  const { CHECKS } = await import("../checklist-checks");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return CHECKS.seat_assigned({ db: db(seats, intents) as any, organizationId: "org-1", conferenceId: "conf-1", entityId: NAMED, taskId: "t" });
};

describe("seat_assigned sweeps by kind, not by named entity", () => {
  it("catches an org whose seats are on a DIFFERENT entity of the same kind", async () => {
    // Greentown's shape: nothing on the named entity, everything unassigned
    // on an equivalently-named one. Previously reported complete.
    expect(await run([
      { entity_id: OTHER, holder_person_id: null },
      { entity_id: OTHER, holder_person_id: null },
    ])).toBe(false);
  });

  it("still passes when that other entity is fully assigned", async () => {
    expect(await run([
      { entity_id: OTHER, holder_person_id: "p1" },
      { entity_id: OTHER, holder_person_id: "p2" },
    ])).toBe(true);
  });

  it("does not let one full entity excuse an empty one", async () => {
    expect(await run([
      { entity_id: NAMED, holder_person_id: "p1" },
      { entity_id: OTHER, holder_person_id: null },
    ])).toBe(false);
  });

  it("still means 'nothing to assign' when the org holds no seats of that kind", async () => {
    // The shortcut was never wrong — it was answering the wrong question.
    expect(await run([])).toBe(true);
  });

  it("ignores seats of another kind entirely", async () => {
    // `event` and `membership_renewal` also carry seats; neither is booth staff.
    expect(await run([
      { entity_id: "some-event", holder_person_id: null, kind: "event" },
    ])).toBe(true);
  });
});

describe("declared usage intent still applies, per entity", () => {
  it("accepts fewer assigned than held when the org said so", async () => {
    expect(await run(
      [
        { entity_id: OTHER, holder_person_id: "p1" },
        { entity_id: OTHER, holder_person_id: null },
        { entity_id: OTHER, holder_person_id: null },
      ],
      [{ entity_id: OTHER, intended_quantity: 1, declared_against_total: 3 }]
    )).toBe(true);
  });

  it("treats a declaration as stale once more seats are bought", async () => {
    // Said "1 of 3", then bought a fourth. The old number is no longer a
    // decision about the new seat, so it reverts to strict.
    expect(await run(
      [
        { entity_id: OTHER, holder_person_id: "p1" },
        { entity_id: OTHER, holder_person_id: null },
        { entity_id: OTHER, holder_person_id: null },
        { entity_id: OTHER, holder_person_id: null },
      ],
      [{ entity_id: OTHER, intended_quantity: 1, declared_against_total: 3 }]
    )).toBe(false);
  });

  it("applies an intent only to the entity it was declared against", async () => {
    expect(await run(
      [
        { entity_id: OTHER, holder_person_id: "p1" },
        { entity_id: OTHER, holder_person_id: null },
        { entity_id: NAMED, holder_person_id: null },
      ],
      [{ entity_id: OTHER, intended_quantity: 1, declared_against_total: 2 }]
    )).toBe(false);
  });
});
