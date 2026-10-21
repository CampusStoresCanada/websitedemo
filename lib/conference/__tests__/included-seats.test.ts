import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Whoever holds a registration holds what it includes (Stephen, 2026-10-21).
 * The included seats are the ones minted by the SAME purchase.
 */

type Seat = { id: string; balance_id: string; entity_id: string; seat_index: number; holder: string | null; kind: string };

let seats: Seat[] = [];
const balances = [
  { id: "bal-reg", purchase_id: "pur-1" },
  { id: "bal-mg", purchase_id: "pur-1" },
  { id: "bal-off", purchase_id: "pur-1" },
  { id: "bal-other", purchase_id: "pur-2" },
];

vi.mock("@/lib/conference/seats", () => ({
  loadSeatHoldings: async (
    _db: unknown,
    q: { seatIds?: string[]; balanceIds?: string[]; holderPersonId?: string; entityKinds?: string[] }
  ) => ({
    seats: seats
      .filter((s) => !q.seatIds || q.seatIds.includes(s.id))
      .filter((s) => !q.balanceIds || q.balanceIds.includes(s.balance_id))
      .filter((s) => !q.holderPersonId || s.holder === q.holderPersonId)
      .filter((s) => !q.entityKinds || q.entityKinds.includes(s.kind))
      .map((s) => ({
        seatId: s.id,
        balanceId: s.balance_id,
        entityId: s.entity_id,
        entityKind: s.kind,
        seatIndex: s.seat_index,
        holderPersonId: s.holder,
      })),
    entitiesById: new Map(),
  }),
  setSeatHolder: async (_db: unknown, seatId: string, personId: string | null, guard: { onlyIfEmpty?: boolean; onlyIfHeldBy?: string } = {}) => {
    const seat = seats.find((s) => s.id === seatId);
    if (!seat) return { changed: false, error: null };
    if (guard.onlyIfEmpty && seat.holder) return { changed: false, error: null };
    if (guard.onlyIfHeldBy && seat.holder !== guard.onlyIfHeldBy) return { changed: false, error: null };
    seat.holder = personId;
    return { changed: true, error: null };
  },
}));

function fakeDb() {
  return {
    from() {
      const filters: Array<[string, unknown]> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const rows = () => balances.filter((r) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  };
}

const { seatIncludedEvents, freeIncludedEvents } = await import("../included-seats");

beforeEach(() => {
  seats = [
    { id: "reg-1", balance_id: "bal-reg", entity_id: "full", seat_index: 1, holder: "karen", kind: "registration" },
    { id: "mg-1", balance_id: "bal-mg", entity_id: "meet", seat_index: 1, holder: null, kind: "event" },
    { id: "mg-2", balance_id: "bal-mg", entity_id: "meet", seat_index: 2, holder: null, kind: "event" },
    { id: "off-1", balance_id: "bal-off", entity_id: "offsite", seat_index: 1, holder: null, kind: "event" },
    // Another purchase's reception seat: never taken.
    { id: "mg-other", balance_id: "bal-other", entity_id: "meet", seat_index: 1, holder: null, kind: "event" },
  ];
});

const holder = (id: string) => seats.find((s) => s.id === id)?.holder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => fakeDb() as any;

describe("a registration's included events", () => {
  it("go to whoever holds the registration, one of each, from the same purchase", async () => {
    await seatIncludedEvents(db(), "conf-1", "reg-1", "karen");
    expect(holder("mg-1")).toBe("karen");
    expect(holder("mg-2")).toBeNull();
    expect(holder("off-1")).toBe("karen");
    expect(holder("mg-other")).toBeNull();
  });

  it("never give somebody a second seat at an event they already hold", async () => {
    seats.find((s) => s.id === "mg-other")!.holder = "karen";
    await seatIncludedEvents(db(), "conf-1", "reg-1", "karen");
    expect(holder("mg-1")).toBeNull();
    expect(holder("off-1")).toBe("karen");
  });

  it("are freed with the registration, and only that person's", async () => {
    seats.find((s) => s.id === "mg-1")!.holder = "karen";
    seats.find((s) => s.id === "mg-2")!.holder = "bob";
    seats.find((s) => s.id === "off-1")!.holder = "karen";
    await freeIncludedEvents(db(), "conf-1", "reg-1", "karen");
    expect(holder("mg-1")).toBeNull();
    expect(holder("off-1")).toBeNull();
    expect(holder("mg-2")).toBe("bob");
  });
});
