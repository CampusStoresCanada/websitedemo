import { describe, expect, it } from "vitest";
import { siblingSeatIds } from "../meeting-candidates";
import type { SeatHolding } from "../seats";

function seat(partial: Partial<SeatHolding> & { seatId: string }): SeatHolding {
  return {
    conferenceId: "conf",
    organizationId: "org",
    seatIndex: null,
    entityId: "type-delegate",
    entityKind: "registration",
    entityName: "Full Conference Registration",
    holderPersonId: null,
    holderName: null,
    holderUserId: null,
    holderContactId: null,
    seatedAt: null,
    ...partial,
  };
}

/**
 * Replaces conference_registrations.linked_registration_id — a hand-kept pointer
 * at a second registration, used so a person attending on two tickets was not
 * booked into both meetings at once. Two seats with the same holder say that on
 * their own.
 */
describe("siblingSeatIds", () => {
  const seats = [
    seat({ seatId: "a", holderPersonId: "person-1" }),
    seat({ seatId: "b", holderPersonId: "person-1" }),
    seat({ seatId: "c", holderPersonId: "person-2" }),
  ];

  it("finds the other seat the same person is named to", () => {
    expect(siblingSeatIds("a", seats)).toEqual(["b"]);
  });

  it("is symmetric", () => {
    expect(siblingSeatIds("b", seats)).toEqual(["a"]);
  });

  it("does not link seats held by different people", () => {
    expect(siblingSeatIds("c", seats)).toEqual([]);
  });

  it("does not link UNASSIGNED seats to each other", () => {
    // Two null holders are not "the same person". Getting this wrong would
    // treat every unsold seat as one giant linked booking and block the grid.
    const unassigned = [seat({ seatId: "x" }), seat({ seatId: "y" })];
    expect(siblingSeatIds("x", unassigned)).toEqual([]);
  });

  it("returns nothing for a seat that is not in the list", () => {
    expect(siblingSeatIds("missing", seats)).toEqual([]);
  });
});
