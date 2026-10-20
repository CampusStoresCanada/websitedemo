import { describe, expect, it } from "vitest";
import { blankCardKey, planReprint, suggestStock } from "../reprint-plan";

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
  // A blank is printed for a company AND a registration type.
  const orgs = [blankCardKey("org-crestar", "reg-full")];
  const spares = [
    { entityId: "reg-full", name: "Full Delegate", count: 6 },
    { entityId: "reg-day", name: "Day Pass", count: 0 },
  ];

  it("suggests the company blank when that company has an unnamed seat", () => {
    expect(
      suggestStock({
        organizationId: "org-crestar",
        unnamedSeatKeys: orgs,
        registrationTypeId: "reg-full",
        sparesByType: spares,
      }).stock
    ).toBe("company_blank");
  });

  it("falls back to a spare of THEIR type when the company has no blank", () => {
    const r = suggestStock({
      organizationId: "org-other",
      unnamedSeatKeys: orgs,
      registrationTypeId: "reg-full",
      sparesByType: spares,
    });
    expect(r.stock).toBe("spare");
    expect(r.reason).toContain("Full Delegate");
  });

  // ⛔ A spare carries its type's schedule. Day Pass printed none; Full
  // Delegate spares exist but would print the wrong days on the back.
  it("refuses another type's spare", () => {
    expect(
      suggestStock({
        organizationId: "org-other",
        unnamedSeatKeys: orgs,
        registrationTypeId: "reg-day",
        sparesByType: spares,
      }).stock
    ).toBe("none");
  });

  it("says none when the run carried no spares", () => {
    expect(
      suggestStock({
        organizationId: "org-other",
        unnamedSeatKeys: orgs,
        registrationTypeId: "reg-full",
        sparesByType: [],
      }).stock
    ).toBe("none");
  });

  // ⛔ The blank's back carries the schedule of the seat it was printed for.
  it("never suggests a company blank of another registration type", () => {
    const r = suggestStock({
      organizationId: "org-crestar",
      unnamedSeatKeys: orgs,
      registrationTypeId: "reg-day",
      registrationTypeName: "Day Pass",
      sparesByType: spares,
    });
    expect(r.stock).toBe("none");
    expect(r.cards).toEqual({ companyBlank: false, spareCount: 0, typeName: "Day Pass" });
  });

  it("lists the cards that exist for them, for the desk's choices", () => {
    const r = suggestStock({
      organizationId: "org-crestar",
      unnamedSeatKeys: orgs,
      registrationTypeId: "reg-full",
      registrationTypeName: "Full Delegate",
      sparesByType: spares,
    });
    expect(r.cards).toEqual({ companyBlank: true, spareCount: 6, typeName: "Full Delegate" });
  });

  it("does not let one company's blank cover another company's person", () => {
    expect(
      suggestStock({
        organizationId: null,
        unnamedSeatKeys: orgs,
        registrationTypeId: "reg-full",
        sparesByType: [],
      }).stock
    ).toBe("none");
  });
});

import {
  clampSlotToStock,
  placeFixedMark,
  DEFAULT_REPRINT_STOCK,
  REPRINT_STOCKS,
} from "../reprint-plan";

/**
 * ⛔ The label is laid out in the BADGE's coordinates, not shrunk to fit. It is
 * applied to a blank printed at full size — a photographically reduced label has
 * a logo and a vertical rhythm that line up with nothing on the card underneath.
 */
describe("laying the variable layer out for the roll", () => {
  const band = { bandX: 44 };

  it("declares the stock rather than burying 62 in a renderer", () => {
    expect(DEFAULT_REPRINT_STOCK.widthMm).toBe(62);
    expect(DEFAULT_REPRINT_STOCK.platform).toContain("QL-1110");
    expect(DEFAULT_REPRINT_STOCK.monochrome).toBe(true);
  });

  it("narrows a slot to the roll and moves nothing", () => {
    const out = clampSlotToStock({ x: 44, width: 850, baselineY: 555 }, band);
    // 62mm of roll, less the right-hand cut margin so no glyph sits on the cut.
    expect(out.width).toBeCloseTo(708.3, 0);
    expect(out.x).toBe(44);          // ⛔ position untouched
    expect(out.baselineY).toBe(555); // ⛔ vertical rhythm untouched
  });

  it("⛔ leaves a slot that already fits completely alone", () => {
    const out = clampSlotToStock({ x: 44, width: 400, baselineY: 555 }, band);
    expect(out.width).toBe(400);
  });

  it("follows the declared stock, so other hardware needs no code change", () => {
    const wide = { ...REPRINT_STOCKS.brother_ql_dk2113, id: "wide", widthMm: 102 };
    const out = clampSlotToStock({ x: 44, width: 850 }, { ...band, stock: wide });
    expect(out.width).toBe(850);
  });

  it("⛔ moves a QR rather than shrinking it — a small QR stops scanning", () => {
    const out = placeFixedMark({ x: 705, size: 200 }, band);
    expect(out.size).toBe(200);
    expect(out.moved).toBe(true);
    expect(out.x + out.size).toBeCloseTo(44 + 708.3, 0);
  });

  it("leaves a mark that already fits exactly where the badge puts it", () => {
    const out = placeFixedMark({ x: 88, size: 216 }, { bandX: 75 });
    expect(out).toMatchObject({ x: 88, size: 216, moved: false, fits: true });
  });

  it("⛔ refuses rather than quietly shrinking a mark wider than the roll", () => {
    expect(placeFixedMark({ x: 44, size: 900 }, band).fits).toBe(false);
  });

  it("puts the stock on a label plan and leaves it off a full-badge one", () => {
    expect(planReprint({ stock: "company_blank", personIsSeated: true }).stockSpec?.widthMm).toBe(62);
    expect(planReprint({ stock: "none", personIsSeated: true }).stockSpec).toBeNull();
  });
});
