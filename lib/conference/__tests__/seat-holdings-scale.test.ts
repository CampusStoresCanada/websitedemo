import { describe, expect, it } from "vitest";
import { loadSeatHoldings } from "@/lib/conference/seats";

// A conference bigger than one API read. The API returns at most 1,000 rows
// per read without saying it cut the list, and rejects a request whose id list
// is a few hundred long. Both used to lose seats: the first silently, the
// second by failing the whole roster.

const CONF = "conf-1";
const CAP = 1000;

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const log = { longestIdList: 0, pagedReads: 0 };
  const db = {
    from: (table: string) => ({
      select: () => {
        let rows = [...(tables[table] ?? [])];
        let range: [number, number] | null = null;
        let ordered = false;
        const q = {
          eq: (col: string, v: unknown) => ((rows = rows.filter((r) => !(col in r) || r[col] === v)), q),
          not: () => q,
          is: () => q,
          in: (col: string, ids: string[]) => {
            log.longestIdList = Math.max(log.longestIdList, ids.length);
            if (ids.length > 200) return { ...q, then: (res: (v: unknown) => void) => res({ data: null, error: { message: "Bad Request" } }) };
            rows = rows.filter((r) => ids.includes(r[col] as string));
            return q;
          },
          order: () => ((ordered = true), q),
          range: (from: number, to: number) => ((range = [from, to]), q),
          then: (res: (v: unknown) => void) => {
            if (range) {
              log.pagedReads++;
              if (!ordered) return res({ data: null, error: { message: "paged without an order" } });
              return res({ data: rows.slice(range[0], range[1] + 1), error: null });
            }
            return res({ data: rows.slice(0, CAP), error: null });
          },
        };
        return q;
      },
    }),
  };
  return { db, log };
}

const pad = (n: number) => String(n).padStart(5, "0");

function conference(seatCount: number) {
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    id: `seat-${pad(i)}`,
    conference_id: CONF,
    organization_id: "org-1",
    entity_id: "reg",
    balance_id: null,
    seat_index: i,
    holder_person_id: `person-${pad(i)}`,
    created_at: "2027-01-01T00:00:00Z",
  }));
  const people = seats.map((s, i) => ({ id: s.holder_person_id, display_name: `Person ${i}`, user_id: null, contact_id: null, canonical_person_id: null }));
  const entities = [{ id: "reg", conference_id: CONF, kind: "registration", name: "Full Conference", is_for_sale: true, price_cents: 0, currency: "CAD", attributes: {}, needs_definition: false, inventory: null, tier_prices: {}, qbo_item_id: null, sales_window: null }];
  return { entity_balance_seats: seats, conference_people: people, conference_entities: entities, conference_entity_refs: [] as Row[] };
}

describe("loadSeatHoldings on a large conference", () => {
  it("returns every seat past the 1,000-row cap, each with its holder's name", async () => {
    const { db, log } = fakeDb(conference(2300));
    const { seats } = await loadSeatHoldings(db as never, { conferenceId: CONF });

    expect(seats).toHaveLength(2300);
    expect(new Set(seats.map((s) => s.seatId)).size).toBe(2300);
    expect(seats.every((s) => s.holderName?.startsWith("Person "))).toBe(true);
    expect(log.pagedReads).toBeGreaterThan(0);
    expect(log.longestIdList).toBeLessThanOrEqual(150);
  });

  it("reads a short list once, without paging", async () => {
    const { db, log } = fakeDb(conference(40));
    const { seats } = await loadSeatHoldings(db as never, { conferenceId: CONF });
    expect(seats).toHaveLength(40);
    expect(log.pagedReads).toBe(0);
  });

  it("does not lose catalogue links past the cap", async () => {
    const data = conference(3);
    data.conference_entities.push({ ...data.conference_entities[0], id: "event", kind: "event", name: "Reception" });
    data.conference_entity_refs = Array.from({ length: 1500 }, (_, i) => ({
      id: `ref-${pad(i)}`,
      conference_id: CONF,
      from_entity_id: "reg",
      to_entity_id: "event",
      role: i === 1499 ? "includes" : "involved_in",
      quantity: null,
    }));
    const { db } = fakeDb(data);
    const { entitiesById } = await loadSeatHoldings(db as never, { conferenceId: CONF });
    const refs = entitiesById.get("reg")?.refs ?? [];
    expect(refs).toHaveLength(1500);
    expect(refs.some((r) => r.role === "includes")).toBe(true);
  });
});
