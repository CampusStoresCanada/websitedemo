import { describe, expect, it } from "vitest";
import { fitTextLayout } from "../text-fit";
import type { BadgeSlotText } from "../template";

/**
 * A slot's declared minimum is a floor, not a suggestion.
 *
 * ⛔ The shrink loop used `Math.min(slot.minPt, ABSOLUTE_MIN_FIT_PT)` with the
 * backstop at 1pt, so the floor resolved to 1pt for EVERY slot and every
 * declared minimum in every template was dead code. Text that could not fit was
 * shrunk until it did — a 20pt organisation name printed at 4.5pt against a
 * declared 9pt minimum — and because it "fitted", `overflowed` stayed false.
 * That flag is what preflight raises TEXT_OVERFLOW from, so the badge passed
 * preflight clean and printed something nobody could read.
 *
 * The point of these tests is the PAIR: stop at the minimum, AND say so.
 */

const slot = (over: Partial<BadgeSlotText> = {}): BadgeSlotText =>
  ({
    x: 0,
    y: 0,
    width: 600,
    height: 120,
    defaultPt: 20,
    minPt: 9,
    maxLines: 1,
    lineHeight: 1.12,
    align: "left",
    color: "#000",
    weight: 400,
    family: "primary",
    transform: "none",
    ...over,
  }) as BadgeSlotText;

const DPI = 300;
const LONG = "THE UNIVERSITY OF NORTHERN BRITISH COLUMBIA BOOKSTORE AND CAMPUS RETAIL SERVICES";

describe("fitTextLayout respects the slot's declared minimum", () => {
  it("never renders below minPt, however long the text is", () => {
    const s = slot();
    expect(fitTextLayout(LONG, s, DPI, { maxLines: 1 }).sizePt).toBeGreaterThanOrEqual(s.minPt);
  });

  it("reports overflow when the minimum is the reason it stopped", () => {
    // ⛔ The half that matters. Stopping at the floor silently would just be a
    // different way to print something wrong — preflight has to be told.
    expect(fitTextLayout(LONG, slot(), DPI, { maxLines: 1 }).overflowed).toBe(true);
  });

  it("honours a higher minimum, not just a token one", () => {
    const s = slot({ minPt: 16 });
    const r = fitTextLayout("BARTHOLOMEW MAXIMILIAN", s, DPI, { maxLines: 1 });
    expect(r.sizePt).toBeGreaterThanOrEqual(16);
    expect(r.overflowed).toBe(true);
  });

  it("still shrinks freely above the minimum, and stays quiet", () => {
    const r = fitTextLayout("ACME SUPPLY CO.", slot(), DPI, { maxLines: 1 });
    expect(r.sizePt).toBeLessThan(20);
    expect(r.sizePt).toBeGreaterThan(9);
    expect(r.overflowed).toBe(false);
  });

  it("leaves short text at its default size", () => {
    expect(fitTextLayout("ACME", slot(), DPI, { maxLines: 1 }).sizePt).toBe(20);
  });

  // The backstop still has a job: it guards a template that declares no usable
  // minimum, so the loop cannot run to zero or negative sizes.
  it("falls back to the absolute backstop when a template declares minPt 0", () => {
    const r = fitTextLayout(LONG, slot({ minPt: 0 }), DPI, { maxLines: 1 });
    expect(r.sizePt).toBeGreaterThanOrEqual(1);
  });
});
