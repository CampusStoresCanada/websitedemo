import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * ⛔ Seats sold is the wrong denominator for a capped thing.
 *
 * A day pass *includes* the evening event on the eve of its day, so a capped
 * $99 reception admits people who never bought a seat on it. 📏 On the live 2027
 * catalogue the Meet & Greet reports 1 direct seat and **14** expected. Counting
 * `entity_balance_seats` would have told a caterer to plan for one.
 */

type Seat = { entityId: string; holderPersonId: string | null };
let seats: Seat[] = [];
let entities: Array<Record<string, unknown>> = [];

vi.mock("@/lib/conference/seats", () => ({
  loadSeatHoldings: async () => ({
    seats,
    entitiesById: new Map(entities.map((e) => [e.id as string, e])),
  }),
}));

const db = {
  from: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.not = () => b;
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    return b;
  },
};

const entity = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, kind: "event", inventory: null, refs: [], attributes: {}, ...over,
});

const load = async () => (await import("../attendance")).loadAttendance(db, "conf-1");

beforeEach(() => {
  seats = [];
  entities = [];
});

describe("loadAttendance", () => {
  it("counts people admitted THROUGH something else, not just direct seats", async () => {
    entities = [
      entity("reception", "Reception", { inventory: 160 }),
      entity("pass", "Day Pass", {
        kind: "registration",
        refs: [{ toEntityId: "reception", role: "includes", quantity: 1 }],
      }),
    ];
    seats = [
      { entityId: "pass", holderPersonId: "p1" },
      { entityId: "pass", holderPersonId: "p2" },
      { entityId: "reception", holderPersonId: "p3" },
    ];
    const reception = (await load()).find((r) => r.entityId === "reception")!;
    expect(reception.directSeats).toBe(1);
    expect(reception.expected).toBe(3);
  });

  // ⛔ Somebody holding a registration AND a separately-bought seat on the same
  // reception is one person in one room.
  it("counts a person once even when two of their seats reach the same thing", async () => {
    entities = [
      entity("reception", "Reception", { inventory: 160 }),
      entity("pass", "Day Pass", {
        kind: "registration",
        refs: [{ toEntityId: "reception", role: "includes", quantity: 1 }],
      }),
    ];
    seats = [
      { entityId: "pass", holderPersonId: "p1" },
      { entityId: "reception", holderPersonId: "p1" },
    ];
    expect((await load()).find((r) => r.entityId === "reception")!.expected).toBe(1);
  });

  // ⚠️ An unnamed seat is still a body in the room; the name just is not in yet.
  it("counts unnamed seats but keeps them separable from named ones", async () => {
    entities = [entity("reception", "Reception", { inventory: 160 })];
    seats = [
      { entityId: "reception", holderPersonId: "p1" },
      { entityId: "reception", holderPersonId: null },
      { entityId: "reception", holderPersonId: null },
    ];
    const row = (await load()).find((r) => r.entityId === "reception")!;
    expect(row.expected).toBe(3);
    expect(row.expectedNamed).toBe(1);
  });

  it("flags over-capacity by how much", async () => {
    entities = [entity("small", "Small Room", { inventory: 2 })];
    seats = [1, 2, 3, 4].map((n) => ({ entityId: "small", holderPersonId: `p${n}` }));
    const row = (await load()).find((r) => r.entityId === "small")!;
    expect(row.over).toBe(2);
  });

  /**
   * ⛔ Vocabulary-free. 60 empty booths, each capped at 1, must not bury three
   * real lines — and the filter that achieves it must not know the word "booth",
   * or this general tool starts carrying one conference's nouns.
   */
  it("drops things with nobody expected and nothing sold", async () => {
    entities = [
      entity("booth-1", "Booth 100", { kind: "booth", inventory: 1 }),
      entity("reception", "Reception", { inventory: 160 }),
    ];
    seats = [{ entityId: "reception", holderPersonId: "p1" }];
    expect((await load()).map((r) => r.entityId)).toEqual(["reception"]);
  });

  // A cap is the signal a human owns the number, so those rows lead.
  it("sorts capped things above bigger uncapped ones", async () => {
    entities = [
      entity("meal", "Breakfast", { kind: "meal" }),
      entity("reception", "Reception", { inventory: 160 }),
      entity("pass", "Pass", {
        kind: "registration",
        refs: [
          { toEntityId: "meal", role: "includes", quantity: 1 },
          { toEntityId: "reception", role: "includes", quantity: 1 },
        ],
      }),
    ];
    seats = [1, 2, 3].map((n) => ({ entityId: "pass", holderPersonId: `p${n}` }));
    seats.push({ entityId: "meal", holderPersonId: "p9" });
    const rows = await load();
    expect(rows[0].entityId).toBe("reception");
  });

  // ⚠️ A cap read wrong is worse than no cap — it reports a full room as fine.
  it("treats an unreadable inventory as uncapped rather than guessing", async () => {
    entities = [entity("odd", "Odd", { inventory: { seats: "lots" } })];
    seats = [{ entityId: "odd", holderPersonId: "p1" }];
    expect((await load())[0].capacity).toBeNull();
  });

  it("reads a numeric-string inventory", async () => {
    entities = [entity("s", "S", { inventory: "40" })];
    seats = [{ entityId: "s", holderPersonId: "p1" }];
    expect((await load())[0].capacity).toBe(40);
  });
});
