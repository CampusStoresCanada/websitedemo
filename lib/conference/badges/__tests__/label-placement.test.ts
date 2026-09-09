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

  it("⛔ sits on the template's own rail, not centred on the card", () => {
    const p = computeLabelPlacement({ ...base, delta: ["name"], contentBottoms: [700] });
    // The sticker joins a column of left edges; centring would place it 8px off.
    expect(p.box.x).toBe(Math.round(front.firstName.x));
  });

  it("clamps a rail that would push the label off the card", () => {
    const far = { ...front, firstName: { ...front.firstName, x: 900 },
                            lastName: { ...front.lastName, x: 900 } };
    const p = computeLabelPlacement({ ...base, front: far, delta: ["name"], contentBottoms: [700] });
    expect(p.box.x + p.box.width).toBeLessThanOrEqual(975);
  });

  it("⛔ takes its top from the DESIGNED box, not the fitted text", () => {
    // firstName defaultPt 64 -> em 266.7px -> top 555 - 213.3 = 341.7, minus pad
    const p = computeLabelPlacement({ ...base, delta: ["name"], contentBottoms: [700] });
    // ⛔ No padding: the label is exactly the designed region. A "cut margin"
    // here is not in the editor and is what pushed an earlier version onto the
    // QR plate.
    expect(p.box.y).toBe(Math.round(555 - (64 / 72) * 300 * 0.8));
  });

  it("⛔ shortens rather than covering a QR plate, and says the render drifted", () => {
    const p = computeLabelPlacement({
      ...base, delta: ["name", "title"], contentBottoms: [1200], // would run past 1066
    });
    expect(p.trimmed).toBe(true);
    expect(p.clearedOf).toHaveLength(1);
    expect(p.box.y + p.box.height).toBeLessThan(1066);
    // Trimming is a SYMPTOM: rendering the editor cannot collide with a plate.
    expect(p.problem).toMatch(/drifted from the layout editor/);
  });

  it("⛔ does NOT trim when rendering what the editor holds", () => {
    // Real geometry: title bottom 1063, QR plate 1066. No padding, no collision.
    const p = computeLabelPlacement({ ...base, delta: ["name", "title"], contentBottoms: [1063] });
    expect(p.trimmed).toBe(false);
    expect(p.problem).toBeNull();
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
