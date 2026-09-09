/**
 * WHERE the reprint label goes on the card — derived, never typed in.
 *
 * ⛔ This module exists because the first version of this work was a shell
 * script with `X=121; Y=543` in it and an ImageMagick composite. Those numbers
 * were correct for one variant of one conference, found by measuring a PNG by
 * eye. There are eleven variants. A number found that way has to be re-found
 * that way, which is not a print pipeline — it is a picture of one.
 *
 * Everything here comes from two sources that already exist and are already the
 * truth: the template's slot geometry, and the overlay artwork's reserved
 * plates. Nothing is measured off a raster.
 */

import { designPxFromPt } from "@/lib/conference/badges/text-fit";
import type { ReprintStock, DeltaField } from "@/lib/conference/badges/reprint-plan";
import type { BadgeTemplateConfigV1, BadgeFrontConfig } from "@/lib/conference/badges/template";

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The white plates in the overlay — the logo disc and the QR plate.
 *
 * ⛔ Read from the artwork, because the artwork is what gets printed. Declaring
 * them a second time in config would be two sources for one fact, and the one
 * that drifts is always the copy.
 *
 * ⚠️ Deliberately only `fill="#ffffff"` circles and rects. The conference logo
 * in the same file also has white paths, but it is inside a transform group and
 * is decoration, not a reserved area. Matching on top-level white primitives is
 * what distinguishes "a plate somebody put here to print on" from "part of a
 * drawing".
 */
export function reservedPlatesFromOverlay(svg: string, canvasWidthPx: number): Box[] {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) return [];
  const k = canvasWidthPx / Number(viewBox[1]);
  const out: Box[] = [];

  for (const m of svg.matchAll(
    /<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"[^>]*fill="#ffffff"[^>]*\/>/g
  )) {
    const [cx, cy, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
    out.push({ x: (cx - r) * k, y: (cy - r) * k, width: r * 2 * k, height: r * 2 * k });
  }
  for (const m of svg.matchAll(
    /<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*fill="#ffffff"[^>]*\/>/g
  )) {
    out.push({
      x: Number(m[1]) * k, y: Number(m[2]) * k,
      width: Number(m[3]) * k, height: Number(m[4]) * k,
    });
  }
  return out;
}

/** The slots a given delta actually prints, in draw order. */
function slotsForDelta(front: BadgeFrontConfig, delta: DeltaField[]) {
  const out = [];
  if (delta.includes("organization")) out.push(front.organizationLine1, front.organizationLine2);
  if (delta.includes("name")) out.push(front.firstName, front.lastName);
  if (delta.includes("title")) out.push(front.title);
  return out;
}

export type LabelPlacement = {
  box: Box;
  /** Which plates the label had to be kept clear of. */
  clearedOf: Box[];
  /** True when the label had to be shortened to avoid a plate. */
  trimmed: boolean;
  /** Set when the label cannot be placed without covering something. */
  problem: string | null;
};

/**
 * ⛔ TOP FROM THE DESIGN, BOTTOM FROM THE CONTENT, and both from the template.
 *
 * The top uses each slot's `defaultPt` — the box the designer draws — not the
 * size the text happens to fit at. Sizing to the fitted text makes the sticker's
 * position depend on how long somebody's name is: 📏 FREDRICO fits at 31.3pt
 * against a 64pt design and put the label 109px (9.2mm) below where the layout
 * editor shows the box. A stable top also means every sticker is the same shape,
 * which matters more at a desk than on screen.
 *
 * The bottom follows the actual lines, because a designed bottom for a 3-line
 * title would reach into the QR plate for a title that is one line long.
 */
export function computeLabelPlacement(params: {
  template: BadgeTemplateConfigV1;
  front: BadgeFrontConfig;
  delta: DeltaField[];
  stock: ReprintStock;
  /** Rendered line counts per slot, in the same order slotsForDelta returns. */
  contentBottoms: number[];
  reserved?: Box[];
  /** Air between the label edge and a plate, in design px. */
  clearance?: number;
  /**
   * ⛔ ZERO, and it must stay zero unless the editor says otherwise.
   *
   * I had this at 24px as a "cut margin". That is not in the layout editor, so
   * it made the label bigger than the design — and the extra 24px pushed it from
   * 1063 onto the QR plate at 1066, which then made the trimming code below fire.
   * The collision was entirely manufactured by the padding.
   *
   * ⚠️ THE PRINCIPLE: if the label renders what the editor holds, it CANNOT
   * collide with a plate, because the designer already placed those slots
   * relative to it. Any collision means the render has drifted from the editor.
   * A physical cut margin belongs to the printer's feed, not to the artwork.
   */
  padding?: number;
}): LabelPlacement {
  const { template, front, delta, stock } = params;
  const dpi = template.canvas.dpi;
  const canvasW = template.canvas.widthIn * dpi;
  const pad = params.padding ?? 0;
  const clearance = params.clearance ?? 12;
  const widthPx = (stock.widthMm / 25.4) * dpi;

  const slots = slotsForDelta(front, delta);
  if (slots.length === 0) {
    return { box: { x: 0, y: 0, width: 0, height: 0 }, clearedOf: [], trimmed: false, problem: "Nothing to print." };
  }

  const designedTop = Math.min(
    ...slots.map((s) => s.baselineY - designPxFromPt(s.defaultPt, dpi) * 0.8)
  );
  const top = designedTop - pad;
  let bottom = Math.max(...params.contentBottoms) + pad;

  // ⛔ ON THE BADGE'S OWN RAIL, not centred on the card.
  //
  // Centring was right when the template had no rail: the logo disc, the QR
  // plate and the QR image all had different left edges, so "align to the
  // plates" had no single answer and equal margins was the best available.
  //
  // The unified layout changed that. Every left edge now shares one x, so there
  // IS a right answer and the label has to sit on it — a sticker applied 8px
  // right of the column it is joining reads as crooked no matter how good its
  // internal spacing is. Taken from the slots themselves so it tracks the
  // template rather than restating a number that lives there.
  //
  // ⚠️ Clamped so a rail close to the right edge cannot push the label off the
  // card; a label that overhangs is worse than one that is centred.
  const rail = Math.min(...slots.map((s) => s.x));
  const x = Math.max(0, Math.min(Math.round(rail), Math.round(canvasW - widthPx)));

  // Keep clear of any plate the label would otherwise cover. A label over the
  // QR plate is a label over a QR: it stops scanning, and it fails at a door.
  const reserved = params.reserved ?? [];
  const clearedOf: Box[] = [];
  let trimmed = false;
  for (const plate of reserved) {
    const overlapsX = x < plate.x + plate.width && x + widthPx > plate.x;
    if (!overlapsX) continue;
    if (plate.y >= top && plate.y < bottom) {
      // ⛔ Reaching here means the render no longer matches the editor. Trim so
      // nothing prints over a QR, but this is a SYMPTOM, not the fix.
      clearedOf.push(plate);
      bottom = plate.y - clearance;
      trimmed = true;
    }
  }

  const height = bottom - top;
  return {
    box: { x, y: Math.round(top), width: Math.round(widthPx), height: Math.round(height) },
    clearedOf,
    trimmed,
    problem:
      trimmed
        ? "Label had to be shortened to clear a plate — the render has drifted from the layout editor."
        : height <= 0
        ? "The label has nowhere to go between the design and the reserved plates."
        : null,
  };
}
