import { describe, expect, it, vi } from "vitest";

/**
 * "Booths sold" on the admin widget must agree with the floor plan.
 *
 * This is the production state of 2026-10-07, trimmed to the four booths that
 * mattered: the widget read 48 while the map painted 44 sold of 60. Every
 * unit of that gap was a BOOTH MOVE. A move refunds part of the original
 * order and mints the new booth, so the order drops to `partially_refunded`
 * — still collected, still counted — while keeping the line item for the
 * booth the org walked away from.
 *
 * Counting order lines therefore counted a moved-away booth forever: once on
 * the stale line, and again when the next buyer took that booth. The fourth
 * way to double-count was prospective_booth_payments, which mints into
 * entity_balances on approval and was then counted a second time as a payment.
 *
 * Neither failure is visible in the database — both numbers are "correct" for
 * the thing they count — and nobody would trace a 4-booth drift back to a
 * move that happened in August. Hence a test.
 */

const CONFERENCE = "conf-1";

/** Booth entity ids, named for the booth numbers they were in production. */
const B203 = "booth-203", B205 = "booth-205", B405 = "booth-405", B407 = "booth-407";
const B716 = "booth-716", B718 = "booth-718", B306 = "booth-306";

const ORDERS = [
  // Varsity Collection bought 203 + 205, then moved to 405 + 407.
  { id: "o-varsity-original", organization_id: "org-varsity", status: "partially_refunded",
    created_at: "2026-08-12 16:03:16+00", paid_at: "2026-08-12 16:03:16+00",
    refund_amount_cents: 452000, refunded_at: "2026-08-14 15:54:28+00" },
  { id: "o-varsity-moved", organization_id: "org-varsity", status: "paid",
    created_at: "2026-08-14 15:54:27+00", paid_at: "2026-08-14 15:54:27+00",
    refund_amount_cents: null, refunded_at: null },
  // MV Sport bought 716 + 718, then moved to 306.
  { id: "o-mvsport-original", organization_id: "org-mvsport", status: "partially_refunded",
    created_at: "2026-08-17 14:52:36+00", paid_at: "2026-08-17 14:52:36+00",
    refund_amount_cents: 226000, refunded_at: "2026-08-28 18:48:30+00" },
  { id: "o-mvsport-moved", organization_id: "org-mvsport", status: "paid",
    created_at: "2026-08-28 18:48:29+00", paid_at: "2026-08-28 18:48:29+00",
    refund_amount_cents: null, refunded_at: null },
  // Kroeger and Kotmo later bought booths MV Sport and Varsity had vacated.
  { id: "o-kroeger", organization_id: "org-kroeger", status: "paid",
    created_at: "2026-09-21 18:54:53+00", paid_at: "2026-09-21 18:54:53+00",
    refund_amount_cents: null, refunded_at: null },
  { id: "o-kotmo", organization_id: "org-kotmo", status: "paid",
    created_at: "2026-10-02 16:27:33+00", paid_at: "2026-10-02 16:27:33+00",
    refund_amount_cents: null, refunded_at: null },
];

const ORDER_ITEMS = [
  // The stale lines: still on the refunded order, booths long since released.
  { order_id: "o-varsity-original", quantity: 1, total_cents: 678000, offer_entity_id: B203 },
  { order_id: "o-varsity-original", quantity: 1, total_cents: 678000, offer_entity_id: B205 },
  { order_id: "o-varsity-moved", quantity: 1, total_cents: 678000, offer_entity_id: B405 },
  { order_id: "o-varsity-moved", quantity: 1, total_cents: 678000, offer_entity_id: B407 },
  { order_id: "o-mvsport-original", quantity: 1, total_cents: 452000, offer_entity_id: B716 },
  { order_id: "o-mvsport-original", quantity: 1, total_cents: 452000, offer_entity_id: B718 },
  { order_id: "o-mvsport-moved", quantity: 1, total_cents: 452000, offer_entity_id: B306 },
  { order_id: "o-kroeger", quantity: 1, total_cents: 452000, offer_entity_id: B718 },
  { order_id: "o-kotmo", quantity: 1, total_cents: 678000, offer_entity_id: B205 },
];

/** Who actually holds a booth — the same rows the floor plan paints as sold. */
const BALANCES = [
  { entity_id: B405, created_at: "2026-08-14 15:54:27+00" },
  { entity_id: B407, created_at: "2026-08-14 15:54:27+00" },
  { entity_id: B306, created_at: "2026-08-28 18:48:29+00" },
  { entity_id: B716, created_at: "2026-09-08 21:56:55+00" }, // JVCKENWOOD, pay-first prospect
  { entity_id: B718, created_at: "2026-09-21 18:54:53+00" }, // Kroeger
  { entity_id: B205, created_at: "2026-10-02 16:27:33+00" }, // Kotmo
];

// JVCKENWOOD paid for 716 before joining CSC, so the booth arrived through
// prospective_booth_payments AND, once minted, through entity_balances.
const PROSPECTIVE_BOOTHS = [
  { booth_amount_cents: 452000, paid_at: "2026-09-08 21:56:55+00" },
];

const ENTITIES = [B203, B205, B405, B407, B716, B718, B306].map(id => ({ id, kind: "booth" }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "not", "in", "order", "limit", "is", "eq"]) b[m] = () => b;

      const rows = (): unknown[] => {
        switch (table) {
          case "conference_instances":
            return [{ id: CONFERENCE, name: "Campus Stores Conference 2027", year: 2027, status: "registration_open" }];
          case "conference_orders": return ORDERS;
          case "conference_order_items": return ORDER_ITEMS;
          case "conference_entities": return ENTITIES;
          case "entity_balances": return BALANCES;
          case "prospective_booth_payments": return PROSPECTIVE_BOOTHS;
          default: return [];
        }
      };
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  }),
}));

describe("the Booths figure on the admin conference widget", () => {
  it("counts booths somebody holds, not booth order lines", async () => {
    const { getConferenceDashboardStats } = await import("../dashboard-stats");
    const stats = await getConferenceDashboardStats();

    // 9 booth order lines + 1 prospective payment used to read as 10 booths.
    expect(stats?.series.booths.total).toBe(BALANCES.length);
  });

  it("counts a moved-away booth once, for whoever holds it now", async () => {
    const { getConferenceDashboardStats } = await import("../dashboard-stats");
    const stats = await getConferenceDashboardStats();
    const byDay = new Map(stats!.series.booths.daily.map(d => [d.date, d.value]));

    // 203 was released and never re-sold: it belongs to nobody, on no day.
    expect(byDay.get("2026-08-12") ?? 0).toBe(0);
    // 205 counts on Kotmo's day, not on Varsity's original purchase day.
    expect(byDay.get("2026-10-02")).toBe(1);
    // 718 counts on Kroeger's day, not MV Sport's.
    expect(byDay.get("2026-09-21")).toBe(1);
  });

  it("counts a pay-first prospect's booth once, not twice", async () => {
    const { getConferenceDashboardStats } = await import("../dashboard-stats");
    const stats = await getConferenceDashboardStats();
    const byDay = new Map(stats!.series.booths.daily.map(d => [d.date, d.value]));

    // 716 arrives as both a prospective payment and a minted holding.
    expect(byDay.get("2026-09-08")).toBe(1);
  });
});
