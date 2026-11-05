import { describe, expect, it } from "vitest";
import {
  bursaryRequestGaps,
  bursaryRequestOpen,
  isBursaryRequestField,
  validateBursaryAnswer,
  type BursaryRequestAnswers,
} from "../bursary-request";

/**
 * The travel bursary request (Steve, 2026-10-28): hotel, travel or both, for
 * one GM-buyer delegate per member school, terms agreed, closing at the end of
 * November 20.
 */

const complete: BursaryRequestAnswers = {
  delegate_seat_id: "11111111-2222-3333-4444-555555555555",
  delegate_contact_id: null,
  covers_hotel: true,
  covers_travel: false,
  payment_preference: "reimburse",
  gm_buyer_confirmed: true,
  notes: null,
};

describe("the question list", () => {
  it("accepts only its own questions", () => {
    expect(isBursaryRequestField("covers_hotel")).toBe(true);
    expect(isBursaryRequestField("requested_at")).toBe(false);
    expect(isBursaryRequestField("status")).toBe(false);
  });

  it("validates each answer's shape", () => {
    expect(validateBursaryAnswer("covers_travel", true)).toEqual({ valid: true, clean: true });
    expect(validateBursaryAnswer("covers_travel", "yes").valid).toBe(false);
    expect(validateBursaryAnswer("delegate_seat_id", "not-an-id").valid).toBe(false);
    expect(validateBursaryAnswer("delegate_seat_id", null)).toEqual({ valid: true, clean: null });
    // Picked from seats now: the old contact pick is not a saveable question.
    expect(isBursaryRequestField("delegate_contact_id")).toBe(false);
  });

  it("keeps the additional-help answer as trimmed text, and blank as nothing", () => {
    expect(validateBursaryAnswer("notes", "  Airport parking in Whitehorse  ")).toEqual({
      valid: true,
      clean: "Airport parking in Whitehorse",
    });
    expect(validateBursaryAnswer("notes", "   ")).toEqual({ valid: true, clean: null });
    expect(validateBursaryAnswer("notes", "x".repeat(2001)).valid).toBe(false);
    expect(validateBursaryAnswer("notes", 5).valid).toBe(false);
  });

  it("does not need the additional-help answer to submit", () => {
    expect(bursaryRequestGaps({ ...complete, notes: null })).toEqual([]);
  });
});

describe("what stands between a request and submitting it", () => {
  it("nothing, when every question is answered", () => {
    expect(bursaryRequestGaps(complete)).toEqual([]);
  });

  it("hotel or travel, at least one", () => {
    expect(bursaryRequestGaps({ ...complete, covers_hotel: false, covers_travel: false })).toEqual([
      "Choose hotel, travel, or both.",
    ]);
  });

  it("the GM-buyer rule must be confirmed, not merely left blank", () => {
    expect(bursaryRequestGaps({ ...complete, gm_buyer_confirmed: null })).toHaveLength(1);
    expect(bursaryRequestGaps({ ...complete, gm_buyer_confirmed: false })).toHaveLength(1);
  });

  it("never waits on the terms: only the person taking the bursary agrees, on their own page", () => {
    expect(bursaryRequestGaps(complete)).toEqual([]);
  });
});

describe("open or closed", () => {
  /** The exclusive boundary: end of November 20 in every Canadian zone. */
  const closesAt = "2026-11-21T08:00:00Z";

  it("is open on November 20, late on the west coast", () => {
    expect(bursaryRequestOpen(closesAt, new Date("2026-11-21T07:59:00Z"))).toBe(true);
  });

  it("is closed from the boundary on", () => {
    expect(bursaryRequestOpen(closesAt, new Date("2026-11-21T08:00:00Z"))).toBe(false);
  });

  it("is open when no deadline is set", () => {
    expect(bursaryRequestOpen(null)).toBe(true);
  });
});

describe("hotel nights (Steve, 2026-11-02)", async () => {
  const { defaultHotelNights, hotelCapCents, hotelNightsText } = await import("../bursary-request");
  const hilton = { nightCents: 18500, taxBps: 1978 };
  it("gives four nights only to the listed schools", () => {
    expect(defaultHotelNights("keyano", ["keyano", "uvic"])).toBe(4);
    expect(defaultHotelNights("stfx", ["keyano", "uvic"])).toBe(3);
    expect(defaultHotelNights("stfx", null)).toBe(3);
  });
  it("says the nights and the ceiling, tax included", () => {
    expect(hotelNightsText(3, hilton)).toBe("3 hotel nights, up to $664.78 including tax");
    expect(hotelNightsText(3, { nightCents: null, taxBps: null })).toBe("3 hotel nights");
  });
  it("rounds once on the total, so four nights is the Hilton's own $886.37", () => {
    // $740 + $146.37 room tax, from the booking (Steve, 2026-11-02).
    expect(hotelCapCents(4, hilton)).toBe(88637);
    expect(hotelCapCents(3, hilton)).toBe(66478);
  });
  it("lets a school submit before it has picked a registration", () => {
    expect(bursaryRequestGaps({ ...complete, delegate_seat_id: null })).toEqual([]);
  });
});

describe("attendanceTermsHtml (MOU Schedule B)", async () => {
  const { attendanceTermsHtml } = await import("../bursary-request");
  it("says nothing to someone who isn't supported", () => {
    expect(attendanceTermsHtml({ funded: false, designated: false, institution: "UVic" })).toBe("");
  });
  it("names the CANCOLL AGM only for a CANCOLL-funded delegate", () => {
    const funded = attendanceTermsHtml({ funded: true, designated: false, institution: "UVic" });
    expect(funded).toContain("CANCOLL Annual General Meeting");
    expect(funded).toContain("UVic will be invoiced for the full value of your registration.");
    const bursary = attendanceTermsHtml({ funded: false, designated: true, institution: "UVic" });
    expect(bursary).not.toContain("Annual General Meeting");
    expect(bursary).toContain("including any hotel and travel costs");
  });
  it("covers both when a CANCOLL delegate also has travel support", () => {
    expect(attendanceTermsHtml({ funded: true, designated: true, institution: "UVic" })).toContain(
      "your registration and any hotel and travel costs"
    );
  });
  it("escapes the institution's name, and uses no em dashes", () => {
    const html = attendanceTermsHtml({ funded: true, designated: true, institution: "A&B <College>" });
    expect(html).toContain("A&amp;B &lt;College&gt;");
    expect(html).not.toContain("—");
  });
});
