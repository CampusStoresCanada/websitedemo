import { describe, expect, it } from "vitest";
import { planReprint, suggestStock } from "../reprint-plan";

/**
 * ⛔ The delta follows the CARD, not the person. A QL cannot overprint a rigid
 * badge — it prints a label that gets applied — so "reprint this badge" is never
 * the question. "What is missing from the card I am holding" is.
 */
describe("what the QL prints", () => {
  it("prints only the person onto a company blank", () => {
    const plan = planReprint({ stock: "company_blank", personIsSeated: true });
    expect(plan.delta).toEqual(["name", "title", "qr"]);
    expect(plan.transport).toBe("ql_label");
  });

  it("prints the company too onto a spare, because a spare is unbranded", () => {
    const plan = planReprint({ stock: "spare", personIsSeated: true });
    expect(plan.delta).toContain("organization");
    expect(plan.delta).toContain("logo");
  });

  it("sends the whole badge to a colour printer when there is no card", () => {
    const plan = planReprint({ stock: "none", personIsSeated: true });
    expect(plan.transport).toBe("full_badge_pdf");
    expect(plan.delta).toEqual([]);
  });
});

/**
 * ⛔ The half that is not printing. A blank is a SEAT — printing a sticker for
 * somebody who holds no seat produces a badge that scans and admits them to
 * nothing.
 */
describe("the write the desk must not skip", () => {
  it("demands a seat assignment for a walk-up handed a company blank", () => {
    const plan = planReprint({ stock: "company_blank", personIsSeated: false });
    expect(plan.seatAssignment?.required).toBe(true);
  });

  it("does not touch seats for a damaged-badge reprint", () => {
    const plan = planReprint({ stock: "company_blank", personIsSeated: true });
    expect(plan.seatAssignment).toBeNull();
  });

  it("never invents a seat when there is no card to hand over", () => {
    const plan = planReprint({ stock: "none", personIsSeated: false });
    expect(plan.seatAssignment).toBeNull();
  });
});

describe("which stock to reach for", () => {
  const orgs = ["org-crestar"];

  it("suggests the company blank when that company has an unnamed seat", () => {
    expect(
      suggestStock({
        organizationId: "org-crestar",
        unnamedSeatOrganizationIds: orgs,
        sparesWerePrinted: true,
      }).stock
    ).toBe("company_blank");
  });

  it("falls back to desk stock when the company has none", () => {
    expect(
      suggestStock({
        organizationId: "org-other",
        unnamedSeatOrganizationIds: orgs,
        sparesWerePrinted: true,
      }).stock
    ).toBe("spare");
  });

  it("says none when the run carried no spares", () => {
    expect(
      suggestStock({
        organizationId: "org-other",
        unnamedSeatOrganizationIds: orgs,
        sparesWerePrinted: false,
      }).stock
    ).toBe("none");
  });

  it("does not let one company's blank cover another company's person", () => {
    expect(
      suggestStock({
        organizationId: null,
        unnamedSeatOrganizationIds: orgs,
        sparesWerePrinted: false,
      }).stock
    ).toBe("none");
  });
});
