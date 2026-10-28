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
  delegate_contact_id: "11111111-2222-3333-4444-555555555555",
  covers_hotel: true,
  covers_travel: false,
  payment_preference: "reimburse",
  gm_buyer_confirmed: true,
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
    expect(validateBursaryAnswer("payment_preference", "prepay")).toEqual({ valid: true, clean: "prepay" });
    expect(validateBursaryAnswer("payment_preference", "cash").valid).toBe(false);
    expect(validateBursaryAnswer("delegate_contact_id", "not-an-id").valid).toBe(false);
    expect(validateBursaryAnswer("delegate_contact_id", null)).toEqual({ valid: true, clean: null });
  });
});

describe("what stands between a request and submitting it", () => {
  it("nothing, when every question is answered and the terms agreed", () => {
    expect(bursaryRequestGaps(complete, true)).toEqual([]);
  });

  it("hotel or travel, at least one", () => {
    expect(bursaryRequestGaps({ ...complete, covers_hotel: false, covers_travel: false }, true)).toEqual([
      "Choose hotel, travel, or both.",
    ]);
  });

  it("the GM-buyer rule must be confirmed, not merely left blank", () => {
    expect(bursaryRequestGaps({ ...complete, gm_buyer_confirmed: null }, true)).toHaveLength(1);
    expect(bursaryRequestGaps({ ...complete, gm_buyer_confirmed: false }, true)).toHaveLength(1);
  });

  it("the terms must be agreed", () => {
    expect(bursaryRequestGaps(complete, false)).toEqual(["Read and agree to the Travel Bursary Terms."]);
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
