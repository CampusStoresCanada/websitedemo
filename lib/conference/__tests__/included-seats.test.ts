import { beforeEach, describe, expect, it, vi } from "vitest";


/**
 * ⛔ Whoever holds a registration holds what it includes (Stephen, 2026-10-21).
 * The included seats are the ones minted by the SAME purchase.
 */

type Seat = { id: string; balance_id: string; entity_id: string; seat_index: number; holder_person_id: string | null; kind: string };

let seats: Seat[] = [];
const balances = [
  { id: "bal-reg", purchase_id: "pur-1" },
  { id: "bal-mg", purchase_id: "pur-1" },
  { id: "bal-off", purchase_id: "pur-1" },
  { id: "bal-other", purchase_id: "pur-2" },
];

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const rows = (): Record<string, unknown>[] =>
        (table === "entity_balances" ? balances : seats.map((s) => ({ ...s, conference_id: "conf-1" }))).filter((r) =>
          filters.every((f) => f(r))
        );
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, val: unknown) => {
        const key = col === "conference_entities.kind" ? "kind" : col;
        filters.push((r) => r[key] === val);
        return b;
      };
      b.neq = (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      };
      b.is = (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => {
        if (patch) {
          for (const r of rows()) {
            const seat = seats.find((s) => s.id === r.id);
            if (seat) Object.assign(seat, patch);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve);
      };
      return b;
    },
  };
}

const { seatIncludedEvents, freeIncludedEvents } = await import("../included-seats");

beforeEach(() => {
  seats = [
    { id: "reg-1", balance_id: "bal-reg", entity_id: "full", seat_index: 1, holder_person_id: "karen", kind: "registration" },
    { id: "mg-1", balance_id: "bal-mg", entity_id: "meet", seat_index: 1, holder_person_id: null, kind: "event" },
    { id: "mg-2", balance_id: "bal-mg", entity_id: "meet", seat_index: 2, holder_person_id: null, kind: "event" },
    { id: "off-1", balance_id: "bal-off", entity_id: "offsite", seat_index: 1, holder_person_id: null, kind: "event" },
    // Another purchase's reception seat: never taken.
    { id: "mg-other", balance_id: "bal-other", entity_id: "meet", seat_index: 1, holder_person_id: null, kind: "event" },
  ];
});

const holder = (id: string) => seats.find((s) => s.id === id)?.holder_person_id;

describe("a registration's included events", () => {
  it("go to whoever holds the registration, one of each, from the same purchase", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seatIncludedEvents(fakeDb() as any, "reg-1", "karen");
    expect(holder("mg-1")).toBe("karen");
    expect(holder("mg-2")).toBeNull();
    expect(holder("off-1")).toBe("karen");
    expect(holder("mg-other")).toBeNull();
  });

  it("never give somebody a second seat at an event they already hold", async () => {
    seats.find((s) => s.id === "mg-other")!.holder_person_id = "karen";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seatIncludedEvents(fakeDb() as any, "reg-1", "karen");
    expect(holder("mg-1")).toBeNull();
    expect(holder("off-1")).toBe("karen");
  });

  it("are freed with the registration, and only that person's", async () => {
    seats.find((s) => s.id === "mg-1")!.holder_person_id = "karen";
    seats.find((s) => s.id === "mg-2")!.holder_person_id = "bob";
    seats.find((s) => s.id === "off-1")!.holder_person_id = "karen";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await freeIncludedEvents(fakeDb() as any, "reg-1", "karen");
    expect(holder("mg-1")).toBeNull();
    expect(holder("off-1")).toBeNull();
    expect(holder("mg-2")).toBe("bob");
  });
});
