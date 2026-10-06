import { describe, expect, it } from "vitest";
import { directPurchaseAllowed, isDirectPurchaseOnly } from "../entity-pricing";

/**
 * Who is allowed to buy an offer that never appears on the storefront.
 *
 * Two of these gates exist in the catalog for different reasons and must not be
 * collapsed into one another:
 *
 *   DEPARTMENT — the $500 Book Partner Attendee Registration, open to
 *   course-materials partners. Reads `nacs_department`, a controlled
 *   vocabulary populated for all 59 active partners. It replaced an exact
 *   match against the deprecated free-text `primary_category`, which matched
 *   exactly two organisations, both cancelled.
 *
 *   NAMED ORGS — the Big Ideas Day rates. Operations partners pay $1,000 and
 *   publishers $500, and NO categorisation separates them. Measured
 *   2026-10-06: Ambassador and Login Canada sit in Course Materials alongside
 *   McGraw Hill, yet are priced as operations; FIEL is Spirit & Gifts and is
 *   also priced as operations. The split is distributor-vs-publisher, a
 *   business model no field encodes. The list IS the decision.
 */

const OPS_ORG = "b809863d-e6c6-4d3e-9343-4b4e19686fae";
const PUBLISHER_ORG = "97485330-26bd-42e5-8161-55ea7572b348";

const partner = (id: string, department: string | null = null) => ({
  id,
  type: "Vendor Partner",
  nacs_department: department,
});

describe("named-org gate", () => {
  const opsOffer = { direct_purchase_only: true, direct_purchase_org_ids: [OPS_ORG] };

  it("admits an org on the list", () => {
    expect(directPurchaseAllowed(opsOffer, partner(OPS_ORG))).toBe(true);
  });

  it("refuses a partner who is simply not on it", () => {
    expect(directPurchaseAllowed(opsOffer, partner(PUBLISHER_ORG))).toBe(false);
  });

  /**
   * The requirement in Steve's words: "make it so that one group can't register
   * for the others pricing." A publisher reaching the $1,000 operations offer,
   * or an operations partner reaching the $500 publisher one, is the failure.
   */
  it("keeps the two Big Ideas rates apart", () => {
    const publisherOffer = { direct_purchase_only: true, direct_purchase_org_ids: [PUBLISHER_ORG] };
    expect(directPurchaseAllowed(publisherOffer, partner(OPS_ORG))).toBe(false);
    expect(directPurchaseAllowed(opsOffer, partner(PUBLISHER_ORG))).toBe(false);
    expect(directPurchaseAllowed(publisherOffer, partner(PUBLISHER_ORG))).toBe(true);
  });

  it("refuses a member even when their id is somehow on the list", () => {
    const member = { id: OPS_ORG, type: "Member", nacs_department: null };
    expect(directPurchaseAllowed(opsOffer, member)).toBe(false);
  });

  it("refuses when there is no buyer at all", () => {
    expect(directPurchaseAllowed(opsOffer, null)).toBe(false);
  });
});

describe("department gate, against NACS", () => {
  // The $500 Book Partner Attendee Registration: course-materials partners only.
  const bookOffer = { direct_purchase_only: true, direct_purchase_department: "Course Materials" };

  it("admits a course-materials partner", () => {
    // Ambassador, Login Canada, McGraw Hill and VitalSource all carry this.
    expect(directPurchaseAllowed(bookOffer, partner("x", "Course Materials"))).toBe(true);
  });

  it("refuses a partner in another department", () => {
    // Bookware and PrismRBS are Technology & Electronics.
    expect(directPurchaseAllowed(bookOffer, partner("y", "Technology & Electronics"))).toBe(false);
  });

  /**
   * ⛔ Exact is right here, unlike on the legacy column it replaced.
   *
   * `nacs_department` is a controlled vocabulary, but two of the 59 partners
   * carry a comma-jammed value that leaked in from the old free-text field
   * ("Apparel: Men's/Unisex, Women's, Youth, Infant/Toddler, Accessories").
   * Those rows are dirty data to be fixed, not a reason to loosen the match —
   * a substring test would make every such row match several departments.
   */
  it("refuses a value that merely contains the department name", () => {
    const dirty = partner("z", "Apparel: Men's/Unisex, Women's, Youth, Infant/Toddler, Accessories");
    expect(directPurchaseAllowed({ ...bookOffer, direct_purchase_department: "Apparel" }, dirty)).toBe(false);
  });

  it("accepts a list of acceptable departments", () => {
    const multi = {
      direct_purchase_only: true,
      direct_purchase_department: ["Technology & Electronics", "Course Materials"],
    };
    expect(directPurchaseAllowed(multi, partner("a", "Technology & Electronics"))).toBe(true);
    expect(directPurchaseAllowed(multi, partner("a", "Campus Living"))).toBe(false);
  });

  it("refuses a partner with no department recorded", () => {
    expect(directPurchaseAllowed(bookOffer, partner("b", null))).toBe(false);
  });
});

describe("both gates together", () => {
  it("requires BOTH when both are set", () => {
    const offer = {
      direct_purchase_only: true,
      direct_purchase_department: "Technology & Electronics",
      direct_purchase_org_ids: [OPS_ORG],
    };
    // Bookware is the named org AND is Technology & Electronics, so it passes both.
    expect(directPurchaseAllowed(offer, partner(OPS_ORG, "Technology & Electronics"))).toBe(true);
    // Named, but in the wrong department.
    expect(directPurchaseAllowed(offer, partner(OPS_ORG, "Campus Living"))).toBe(false);
    // Right department, but not named.
    expect(directPurchaseAllowed(offer, partner("someone-else", "Technology & Electronics"))).toBe(false);
  });

  it("admits any partner when neither gate is set", () => {
    expect(directPurchaseAllowed({ direct_purchase_only: true }, partner("anyone"))).toBe(true);
  });
});

/**
 * Big Ideas Presentations carried the STRING "true" here until 2026-10-06. The
 * gate tested `=== true`, so it read false, and with is_for_sale also false the
 * cart returned "This thing isn't for sale." Nobody could buy a slot, and
 * nothing anywhere said why.
 */
describe("the for-sale flag is a boolean", () => {
  it("accepts a real boolean", () => {
    expect(isDirectPurchaseOnly({ direct_purchase_only: true })).toBe(true);
  });

  it("does NOT accept the string, so bad data fails closed and stays visible", () => {
    expect(isDirectPurchaseOnly({ direct_purchase_only: "true" })).toBe(false);
  });

  it("is false when absent", () => {
    expect(isDirectPurchaseOnly({})).toBe(false);
    expect(isDirectPurchaseOnly(null)).toBe(false);
  });
});
