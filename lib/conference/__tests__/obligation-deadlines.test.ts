import { describe, expect, it } from "vitest";
import { resolveObligationDeadline, DEADLINE_WAITING_ON } from "../obligation-deadlines";

const CSC_2027 = {
  startDate: "2027-02-01",
  registrationCloseAt: "2027-01-31T04:59:59+00:00",
  hotelBookingCutoff: "2027-01-08",
  cateringCutoff: "2027-01-18",
};

describe("resolving what can be resolved", () => {
  it("dates registration_close from the conference", () => {
    expect(resolveObligationDeadline("registration_close", CSC_2027).dueOn).toBe("2027-01-31");
  });

  it("takes the date part rather than shifting it across a timezone", () => {
    // A due DATE is not an instant. Re-interpreting the stored timestamp in a
    // zone is how a deadline quietly loses a day.
    expect(resolveObligationDeadline("registration_close", CSC_2027).dueOn).toBe("2027-01-31");
  });

  it("dates dietary from the caterer, not from registration closing", () => {
    // These are thirteen days apart for CSC 2027. Borrowing registration_close
    // showed people 31 January when the caterer needs numbers by the 18th — a
    // deadline wrong in the generous direction, which people plan to.
    expect(resolveObligationDeadline("catering_cutoff", CSC_2027).dueOn).toBe("2027-01-18");
    expect(resolveObligationDeadline("registration_close", CSC_2027).dueOn).toBe("2027-01-31");
  });

  it("refuses to invent the three with no source", () => {
    for (const symbol of ["badge_print", "offsite_lock", "travel_cutoff"] as const) {
      expect(resolveObligationDeadline(symbol, CSC_2027).dueOn).toBeNull();
    }
  });

  it("keeps the symbol so an undated item can say what it waits on", () => {
    const r = resolveObligationDeadline("offsite_lock", CSC_2027);
    expect(r.symbol).toBe("offsite_lock");
    expect(DEADLINE_WAITING_ON[r.symbol]).toBe("before the offsite numbers are locked");
  });

  it("returns null rather than guessing when the conference has no dates", () => {
    const empty = { startDate: null, registrationCloseAt: null, hotelBookingCutoff: null, cateringCutoff: null };
    expect(resolveObligationDeadline("registration_close", empty).dueOn).toBeNull();
  });
});
