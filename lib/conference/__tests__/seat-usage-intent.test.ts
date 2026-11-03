import { describe, expect, it } from "vitest";
import { declaredSeatsToFill, declinedSeatIds } from "../seats";

/**
 * "Bought 4, sending 1." Rains declared "using 1 of 4" on 2026-11-01 and the
 * org page kept asking for three more names, because only the checklist read
 * the declaration. One rule now, read by every surface.
 */

const intent = (intended_quantity: number, declared_against_total: number) => ({
  intended_quantity,
  declared_against_total,
});

describe("declaredSeatsToFill", () => {
  it("is null when nothing was declared", () => {
    expect(declaredSeatsToFill(4, null)).toBeNull();
  });
  it("is the declared number while it still applies", () => {
    expect(declaredSeatsToFill(4, intent(1, 4))).toBe(1);
  });
  it("goes stale when they bought more after declaring", () => {
    expect(declaredSeatsToFill(6, intent(1, 4))).toBeNull();
  });
  it("is capped at the real count after a refund", () => {
    expect(declaredSeatsToFill(2, intent(3, 4))).toBe(2);
  });
});

describe("declinedSeatIds", () => {
  const seat = (seatId: string, seatIndex: number, holderPersonId: string | null, entityId = "staff", organizationId = "org-1") => ({
    seatId, seatIndex, holderPersonId, entityId, organizationId,
  });

  it("declines the empty seats past the declared number, keeping the lowest-numbered", () => {
    const seats = [seat("a", 0, "jason"), seat("b", 1, null), seat("c", 2, null), seat("d", 3, null)];
    expect(declinedSeatIds(seats, new Map([["org-1|staff", intent(2, 4)]]))).toEqual(new Set(["c", "d"]));
  });

  it("never declines a named seat, even past the declared number", () => {
    const seats = [seat("a", 0, "p1"), seat("b", 1, "p2"), seat("c", 2, null)];
    expect(declinedSeatIds(seats, new Map([["org-1|staff", intent(1, 3)]]))).toEqual(new Set(["c"]));
  });

  it("declines nothing for an org that never declared, or whose declaration is stale", () => {
    const seats = [seat("a", 0, null), seat("b", 1, null), seat("c", 2, null, "staff", "org-2")];
    const intents = new Map([["org-1|staff", intent(0, 1)]]); // stale: they now hold 2
    expect(declinedSeatIds(seats, intents).size).toBe(0);
  });
});
