import { describe, it, expect } from "vitest";
import {
  redactContactDetails,
  countRedactions,
  isExcludedSpace,
  EMAIL_MASK,
  PHONE_MASK,
} from "../redact";

describe("redactContactDetails", () => {
  it("removes an email but keeps the sentence readable", () => {
    // "email me at [email]" is still evidence someone offered to take it
    // offline; "email me at" reads like a truncation bug.
    expect(redactContactDetails("Hi Karin, email me at julie.forgie@ubc.ca thanks")).toBe(
      `Hi Karin, email me at ${EMAIL_MASK} thanks`
    );
  });

  it("catches the shapes people actually write", () => {
    for (const raw of [
      "tomst@vendtek.com",
      "first.last+campus@sub.domain.co.uk",
      "SALES@BIGBRANDS.CA",
    ]) {
      expect(redactContactDetails(raw), raw).toBe(EMAIL_MASK);
    }
  });

  it("removes phone numbers in their common forms", () => {
    for (const raw of ["416-921-4181", "(604) 555 1234", "+1 780.555.9000"]) {
      expect(redactContactDetails(raw), raw).toContain(PHONE_MASK);
    }
  });

  it("⛔ never eats the numbers a procurement corpus is made of", () => {
    // A greedy digit pattern would swallow the substance: quantities, prices,
    // product codes and minimums are the whole point of these conversations.
    const kept = [
      "we ordered 100pc at 11.50 each",
      "our cost is just over $35 per unit and we sell them for $69.99",
      "MOQ is 300 units",
      "the 695HBM runs about 24.00",
      "GM% for last year was 17.4",
    ];
    for (const raw of kept) expect(redactContactDetails(raw), raw).toBe(raw);
  });

  it("leaves ordinary prose completely alone", () => {
    const raw = "We use Bookware and have forever. Backpack sales are way down.";
    expect(redactContactDetails(raw)).toBe(raw);
  });

  it("handles several details in one message", () => {
    const out = redactContactDetails("reach sharon@intertrade.ca or 604-555-1212 today");
    expect(out).toBe(`reach ${EMAIL_MASK} or ${PHONE_MASK} today`);
  });

  it("is safe on empty input", () => {
    expect(redactContactDetails("")).toBe("");
  });
});

describe("countRedactions", () => {
  it("reports what a pass would remove", () => {
    expect(countRedactions("a@b.ca and c@d.ca and 416-921-4181")).toEqual({
      emails: 2,
      phones: 1,
    });
  });
});

describe("isExcludedSpace", () => {
  it("excludes the board's own deliberation", () => {
    // Directors debating a motion is the association reasoning about itself.
    // It says nothing about what any store buys.
    expect(isExcludedSpace("Board Stuff")).toBe(true);
  });

  it("keeps the spaces where members talk about their stores", () => {
    for (const s of ["General Merchandise", "Course Materials", "Old Ask the community"]) {
      expect(isExcludedSpace(s), s).toBe(false);
    }
  });

  it("treats an unknown or missing space as includable", () => {
    expect(isExcludedSpace(null)).toBe(false);
    expect(isExcludedSpace(undefined)).toBe(false);
  });
});
