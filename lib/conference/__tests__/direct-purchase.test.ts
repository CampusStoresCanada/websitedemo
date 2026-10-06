import { describe, expect, it } from "vitest";
import { directPurchaseAllowed, isDirectPurchaseOnly } from "../entity-pricing";

/**
 * Who is allowed to buy an offer that never appears on the storefront.
 *
 * NAMED ORGS — the Big Ideas Day rates. Operations partners pay $1,000 and
 *   publishers $500, and NO categorisation separates them. Measured
 *   2026-10-06: Ambassador and Login Canada sit in Course Materials alongside
 *   McGraw Hill, yet are priced as operations; FIEL is Spirit & Gifts and is
 *   also priced as operations. The split is distributor-vs-publisher, a
 *   business model no field encodes. The list IS the decision.
 */

const OPS_ORG = "b809863d-e6c6-4d3e-9343-4b4e19686fae";
const PUBLISHER_ORG = "97485330-26bd-42e5-8161-55ea7572b348";

const partner = (id: string) => ({ id, type: "Vendor Partner" });

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
    const member = { id: OPS_ORG, type: "Member" };
    expect(directPurchaseAllowed(opsOffer, member)).toBe(false);
  });

  it("refuses when there is no buyer at all", () => {
    expect(directPurchaseAllowed(opsOffer, null)).toBe(false);
  });
});

/**
 * ⛔ There WAS a department gate here, matching organizations.nacs_department.
 * It existed for exactly one offer, the Book Partner Attendee Registration,
 * which was withdrawn on 2026-10-06. Both the branch and these tests came down
 * with it rather than being kept warm for a job that may never arrive.
 *
 * Worth keeping from it, because it cost a morning to establish:
 * primary_category is DEPRECATED — free text, 57/59, 31 distinct comma-jammed
 * values — and nacs_department is the controlled vocabulary, populated 59/59.
 * Anything that needs to reason about a partner's category reads NACS.
 */

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
