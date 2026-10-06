import { describe, expect, it } from "vitest";
import { directPurchaseAllowed, isDirectPurchaseOnly } from "../entity-pricing";

/**
 * Who is allowed to buy an offer that never appears on the storefront.
 *
 * Two of these gates exist in the catalog for different reasons and must not be
 * collapsed into one another:
 *
 *   CATEGORY — the $500 Book Partner Attendee Registration. Specified as
 *   "member partner whose primary category is books", deliberately invisible
 *   and narrow. Exact match is the FEATURE; a substring would open it to every
 *   org with "Books" anywhere in a comma-jammed category string.
 *
 *   NAMED ORGS — the Big Ideas Day rates. Operations partners pay $1,000 and
 *   publishers $500, and NOTHING in the data separates them: both resolve to
 *   the `partner` tier, and organizations.primary_category is free text that
 *   matches exactly 2 of the 7 orgs named by hand. The list IS the decision.
 */

const OPS_ORG = "b809863d-e6c6-4d3e-9343-4b4e19686fae";
const PUBLISHER_ORG = "97485330-26bd-42e5-8161-55ea7572b348";

const partner = (id: string, category: string | null = null) => ({
  id,
  type: "Vendor Partner",
  primary_category: category,
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
    const member = { id: OPS_ORG, type: "Member", primary_category: null };
    expect(directPurchaseAllowed(opsOffer, member)).toBe(false);
  });

  it("refuses when there is no buyer at all", () => {
    expect(directPurchaseAllowed(opsOffer, null)).toBe(false);
  });
});

describe("category gate stays exact", () => {
  const bookOffer = { direct_purchase_only: true, direct_purchase_category: "Books" };

  it("admits the exact category", () => {
    expect(directPurchaseAllowed(bookOffer, partner("x", "Books"))).toBe(true);
  });

  /**
   * ⛔ The one that must never be "fixed" into a substring match. Login Canada's
   * category really is "Books, Course Materials, Textbooks, Physical Textbooks,
   * eBooks, Trade Books, Lanyards & Badges, Lab Supplies" — loosening this
   * would silently sell them a registration meant to be invisible to them.
   */
  it("refuses a comma-jammed category that merely contains the word", () => {
    const loginCanada = partner("y", "Books, Course Materials, Textbooks, eBooks, Trade Books");
    expect(directPurchaseAllowed(bookOffer, loginCanada)).toBe(false);
  });

  it("accepts a list of acceptable categories", () => {
    const multi = { direct_purchase_only: true, direct_purchase_category: ["Store Operations", "Books"] };
    expect(directPurchaseAllowed(multi, partner("z", "Store Operations"))).toBe(true);
    expect(directPurchaseAllowed(multi, partner("z", "Campus Living"))).toBe(false);
  });
});

describe("both gates together", () => {
  it("requires BOTH when both are set", () => {
    const offer = {
      direct_purchase_only: true,
      direct_purchase_category: "Store Operations",
      direct_purchase_org_ids: [OPS_ORG],
    };
    expect(directPurchaseAllowed(offer, partner(OPS_ORG, "Store Operations"))).toBe(true);
    expect(directPurchaseAllowed(offer, partner(OPS_ORG, "Campus Living"))).toBe(false);
    expect(directPurchaseAllowed(offer, partner("someone-else", "Store Operations"))).toBe(false);
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
