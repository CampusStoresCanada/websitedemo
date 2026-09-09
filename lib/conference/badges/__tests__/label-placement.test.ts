import { describe, expect, it } from "vitest";
import { reservedPlatesFromOverlay, computeLabelPlacement } from "../label-placement";
import { DEFAULT_BADGE_TEMPLATE_CONFIG_V1 as T } from "../template";
import { DEFAULT_REPRINT_STOCK } from "../reprint-plan";

const EXHIBITOR_OVERLAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 235 379">
  <circle cx="57" cy="103" r="27.5" fill="#ffffff"/>
  <rect x="31" y="257" width="51" height="51" fill="#ffffff"/>
  <g transform="translate(180,312)"><path fill="#ffffff" d="M22 6L1 31Z"/></g>
</svg>`;

/**
 * ⛔ The plates come from the ARTWORK. Declaring them again in config would be
 * two sources for one fact, and the copy is what drifts.
 */
describe("reading the reserved plates", () => {
  const plates = reservedPlatesFromOverlay(EXHIBITOR_OVERLAY, 975);

  it("finds the logo disc and the QR plate, scaled to the canvas", () => {
    expect(plates).toHaveLength(2);
    const [logo, qr] = plates;
    expect(logo.x).toBeCloseTo(122, 0); // (57-27.5) * 975/235
    expect(qr.x).toBeCloseTo(129, 0);   // 31 * 975/235
    expect(qr.y).toBeCloseTo(1066, 0);  // 257 * 975/235
  });

  it("⛔ ignores white paths inside the logo group — decoration, not a plate", () => {
    // The conference logo has white <path> fills; only primitives count.
    expect(reservedPlatesFromOverlay(EXHIBITOR_OVERLAY, 975).every((p) => p.width > 0)).toBe(true);
    expect(plates.some((p) => p.width > 900)).toBe(false);
  });

  it("returns nothing for artwork with no plates rather than guessing", () => {
    expect(reservedPlatesFromOverlay(`<svg viewBox="0 0 235 379"></svg>`, 975)).toEqual([]);
  });
});

describe("placing the label", () => {
  const front = T.front;
  const plates = reservedPlatesFromOverlay(EXHIBITOR_OVERLAY, 975);
  const base = {
    template: T, front, delta: ["name", "title"] as const,
    stock: DEFAULT_REPRINT_STOCK, reserved: plates,
  };

  it("centres it, so the margins are equal", () => {
    const p = computeLabelPlacement({ ...base, delta: ["name"], contentBottoms: [700] });
    expect(p.box.x).toBe(Math.round((975 - 732.28) / 2));
    // 975 - 732 leaves an odd remainder, so the margins are 121 and 122.
    expect(Math.abs(975 - p.box.x - p.box.width - p.box.x)).toBeLessThanOrEqual(1);
  });

  it("⛔ takes its top from the DESIGNED box, not the fitted text", () => {
    // firstName defaultPt 64 -> em 266.7px -> top 555 - 213.3 = 341.7, minus pad
    const p = computeLabelPlacement({ ...base, delta: ["name"], contentBottoms: [700] });
    expect(p.box.y).toBe(Math.round(555 - (64 / 72) * 300 * 0.8 - 24));
  });

  it("⛔ shortens rather than covering a QR plate", () => {
    const p = computeLabelPlacement({
      ...base, delta: ["name", "title"], contentBottoms: [1200], // would run past 1066
    });
    expect(p.trimmed).toBe(true);
    expect(p.clearedOf).toHaveLength(1);
    expect(p.box.y + p.box.height).toBeLessThan(1066);
  });

  it("leaves a label that already clears the plate untouched", () => {
    const p = computeLabelPlacement({ ...base, delta: ["name"], contentBottoms: [800] });
    expect(p.trimmed).toBe(false);
    expect(p.clearedOf).toEqual([]);
  });

  it("reports a problem instead of emitting a negative-height label", () => {
    const p = computeLabelPlacement({
      ...base, delta: ["name"], contentBottoms: [0], reserved: [{ x: 0, y: 100, width: 975, height: 50 }],
    });
    expect(p.problem).not.toBeNull();
  });
});
