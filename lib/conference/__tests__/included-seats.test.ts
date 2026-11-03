import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Whoever holds a registration holds what it includes (Stephen, 2026-10-21).
 * The included seats are the ones minted by the SAME purchase.
 */

type Seat = { id: string; balance_id: string; entity_id: string; seat_index: number; holder: string | null; kind: string };

let seats: Seat[] = [];
let balances: Array<{ id: string; purchase_id: string }> = [];
let conversions: Array<{ funded_purchase_id: string; source_order_id: string; from_entity_id: string }> = [];
const orderItems = [{ id: "item-1", order_id: "order-1" }];
const purchases = [{ id: "pur-1", order_item_id: "item-1", offer_entity_id: "full" }];
const tables: Record<string, () => Array<Record<string, unknown>>> = {
  entity_balances: () => balances,
  conference_funded_conversions: () => conversions,
  conference_order_items: () => orderItems,
  entity_purchases: () => purchases,
};

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
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const rows = () => tables[table]().filter((r) => filters.every((f) => f(r)));
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
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
  balances = [
    { id: "bal-reg", purchase_id: "pur-1" },
    { id: "bal-mg", purchase_id: "pur-1" },
    { id: "bal-off", purchase_id: "pur-1" },
    { id: "bal-other", purchase_id: "pur-2" },
  ];
  conversions = [];
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

  it("still follow the registration after it is switched to the CANCOLL-funded one", async () => {
    // The switch moves the registration onto a $0 purchase of the funded
    // offer; the reception and offsite stay on the purchase the school paid for.
    balances.find((b) => b.id === "bal-reg")!.purchase_id = "pur-funded";
    conversions = [{ funded_purchase_id: "pur-funded", source_order_id: "order-1", from_entity_id: "full" }];
    seats.find((s) => s.id === "reg-1")!.entity_id = "full-cancoll";
    seats.find((s) => s.id === "mg-1")!.holder = "karen";
    seats.find((s) => s.id === "off-1")!.holder = "karen";

    await freeIncludedEvents(db(), "conf-1", "reg-1", "karen");
    expect(holder("mg-1")).toBeNull();
    expect(holder("off-1")).toBeNull();

    await seatIncludedEvents(db(), "conf-1", "reg-1", "bob");
    expect(holder("mg-1")).toBe("bob");
    expect(holder("off-1")).toBe("bob");
    expect(holder("mg-other")).toBeNull();
  });
});
