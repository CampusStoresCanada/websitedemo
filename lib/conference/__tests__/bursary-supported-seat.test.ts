import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { supportedSeat } = await import("../bursary-access");

/**
 * A school's supported registration is ONE seat: its travel support, its
 * CANCOLL funding and its recipient's terms (Steve, 2026-11-05).
 */

const entities = new Map<string, { attributes: Record<string, unknown> | null }>([
  ["full", { attributes: {} }],
  ["funded", { attributes: { funded_by: "cancoll", funds_offer_id: "full" } }],
]);

const seat = (seatId: string, entityId: string, holderPersonId: string | null) =>
  ({ seatId, entityId, entityKind: "registration", holderPersonId }) as never;

describe("supportedSeat", () => {
  it("is the CANCOLL-funded registration when the school holds one, whatever the request picked", () => {
    const seats = [seat("paid", "full", "karl"), seat("free", "funded", "mary")];
    expect(supportedSeat(seats, entities, "paid")).toMatchObject({ seatId: "free" });
  });

  it("is the picked registration for a school without CANCOLL funding", () => {
    const seats = [seat("a", "full", "karl"), seat("b", "full", "mary")];
    expect(supportedSeat(seats, entities, "b")).toMatchObject({ seatId: "b" });
  });

  it("prefers a funded registration someone holds over an empty one", () => {
    const seats = [seat("empty", "funded", null), seat("held", "funded", "karl")];
    expect(supportedSeat(seats, entities, null)).toMatchObject({ seatId: "held" });
  });

  it("is nothing when nothing is picked and nothing is funded", () => {
    expect(supportedSeat([seat("a", "full", "karl")], entities, null)).toBeNull();
  });
});
