import { describe, it, expect } from "vitest";
import { fieldKeyFromSelector } from "@/lib/circle/flag-routing";

/**
 * ⛔ Written to every flag row since the toolkit shipped and read by nothing,
 * which is why three reports from one store arrived indistinguishable.
 */
describe("recovering the survey field from a toolkit selector", () => {
  it("reads the field name the survey rendered", () => {
    expect(fieldKeyFromSelector("#field-cm_sell_through_pct")).toBe("cm_sell_through_pct");
    expect(fieldKeyFromSelector("#field-total_transaction_count")).toBe("total_transaction_count");
  });

  /*
    The toolkit falls back to a positional path when the flagged element is a
    section or a label rather than a field. That identifies nothing durable —
    one inserted div and it points at something else — so it must not be
    mistaken for a field name.
  */
  it("returns nothing for a positional path", () => {
    expect(
      fieldKeyFromSelector("div:nth-child(2) > div:nth-child(3) > div:nth-child(1)"),
    ).toBeNull();
    expect(fieldKeyFromSelector("main:nth-child(1) > div:nth-child(1)")).toBeNull();
  });

  it("returns nothing when there was no selector at all", () => {
    expect(fieldKeyFromSelector(null)).toBeNull();
  });

  it("does not accept a review selector from elsewhere on the site", () => {
    expect(
      fieldKeyFromSelector("#review-organizations-email-1c83867e-16e2-4c53-9529-3fcbac5cd6ad"),
    ).toBeNull();
  });
});
