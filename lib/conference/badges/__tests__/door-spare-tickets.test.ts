import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ A company's spare ticket to an event is one no unnamed registration is
 * waiting for (Jenna at the door, 2026-10-21). The Meet & Greet seat that came
 * with an unnamed Full Conference Registration belongs to whoever the company
 * names; only tickets beyond that can go to somebody at the door.
 */

type Seat = { seatId: string; balanceId: string; entityId: string; entityKind: string; entityName: string; seatIndex: number };
let open: Seat[] = [];
const purchaseOfBalance: Record<string, string> = {
  "bal-reg": "pur-1",
  "bal-mg": "pur-1",
  "bal-guest": "pur-2",
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/conference/seats", () => ({
  ENTITY_SELECT: "",
  buildEntityGraph: () => [],
  loadSeatHoldings: async () => ({
    seats: open.map((s) => ({ ...s, organizationId: "org-ucn", holderPersonId: null })),
    entitiesById: new Map(),
  }),
}));

function fakeDb() {
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.in = () => b;
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "entity_balances"
              ? Object.entries(purchaseOfBalance).map(([id, purchase_id]) => ({ id, purchase_id }))
              : [{ id: "org-ucn", name: "University College of the North" }],
          error: null,
        }).then(resolve);
      return b;
    },
  };
}

const { openEventSeats } = await import("../checkin");

beforeEach(() => {
  open = [];
});

const reg = (n: number): Seat => ({ seatId: `reg-${n}`, balanceId: "bal-reg", entityId: "full", entityKind: "registration", entityName: "Full Conference", seatIndex: n });
const mg = (n: number, balanceId = "bal-mg"): Seat => ({ seatId: `${balanceId}-${n}`, balanceId, entityId: "meet", entityKind: "event", entityName: "Meet & Greet Reception", seatIndex: n });

describe("a company's spare event tickets", () => {
  it("hold back the reception seat an unnamed registration is waiting for", async () => {
    open = [reg(2), mg(1), mg(2)]; // registration 1 is named; 2 is not
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spare = await openEventSeats(fakeDb() as any, "conf-1");
    expect(spare.map((s) => s.seatId)).toEqual(["bal-mg-2"]);
    expect(spare[0]).toMatchObject({ entityKind: "event", organizationName: "University College of the North" });
  });

  it("offer every ticket bought on its own", async () => {
    open = [reg(1), mg(1), mg(1, "bal-guest")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spare = await openEventSeats(fakeDb() as any, "conf-1");
    expect(spare.map((s) => s.seatId)).toEqual(["bal-guest-1"]);
  });

  it("offer nothing when every open reception seat is spoken for", async () => {
    open = [reg(1), reg(2), mg(1), mg(2)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await openEventSeats(fakeDb() as any, "conf-1")).toEqual([]);
  });
});
