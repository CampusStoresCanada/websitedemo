/**
 * The reprint label: the variable layer, laid out for the roll.
 *
 * ⛔ This is NOT a scaled-down badge and NOT a crop of one. It renders the same
 * slots, at the same x and baselineY the badge uses, with widths clamped to the
 * stock — so the text on the label lands exactly where the badge would have put
 * it on the card underneath. That is the whole reason a label can be stuck onto
 * a pre-printed blank and look like it belongs.
 *
 * ⚠️ Thermal, so black only. The film is frosted clear: anything not printed
 * shows the badge through it, which is why the background here is transparent
 * rather than white.
 */

import { fitTextLayout, designPxFromPt } from "@/lib/conference/badges/text-fit";
import { clampSlotToStock, type ReprintStock, type DeltaField } from "@/lib/conference/badges/reprint-plan";
import type { BadgeTemplateConfigV1, BadgeSlotText } from "@/lib/conference/badges/template";

const TYPEKIT = "https://use.typekit.net/uxh8ckq.css";

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

type Placed = {
  slot: BadgeSlotText;
  lines: string[];
  sizePt: number;
  trackingEm: number;
  lineHeightEm: number;
  top: number;
  height: number;
};

/**
 * ⛔ Mirrors renderTextBlock in render-html.ts exactly — `baselineY - fontPx*0.8`.
 * If the label used a different vertical rule the text would sit off the line the
 * badge would have put it on, and every applied sticker would look crooked.
 */
function place(text: string, slot: BadgeSlotText, dpi: number): Placed | null {
  const clean = text.trim();
  if (!clean) return null;
  const layout = fitTextLayout(clean, slot, dpi);
  const fontPx = designPxFromPt(layout.sizePt, dpi);
  return {
    slot,
    lines: layout.lines,
    sizePt: layout.sizePt,
    trackingEm: layout.trackingEm,
    lineHeightEm: layout.lineHeightEm,
    top: slot.baselineY - fontPx * 0.8,
    height: layout.lines.length * fontPx * layout.lineHeightEm,
  };
}

export function renderReprintLabel(params: {
  person: { firstName: string; lastName: string; roleTitle: string; organizationName?: string };
  template: BadgeTemplateConfigV1;
  delta: DeltaField[];
  stock: ReprintStock;
  /** Left edge of the variable band on the badge, in design px. */
  bandX: number;
  /** Draw the roll edges, for an alignment proof. */
  showGuides?: boolean;
  /**
   * ⛔ Left-align every line to the sticker's own edge.
   *
   * The badge hangs its name text at x=44, further left than anything else on
   * the card — the logo plate starts at 122 and the QR plate at 129. That is
   * fine for ink printed INTO the design, but a physical sticker whose edge sits
   * at 44 overhangs the card's visual margin and reads as misplaced. A sticker
   * is an object with an edge, so its edge is what has to line up.
   */
  anchorTextToEdge?: boolean;
}): { html: string; widthMm: number; heightMm: number } {
  const { template, delta, stock, bandX } = params;
  const dpi = template.canvas.dpi;
  const front = template.front;
  const clamp = (s: BadgeSlotText) => {
    const anchored = params.anchorTextToEdge ? { ...s, x: bandX } : s;
    return clampSlotToStock(anchored, { bandX, stock, dpi });
  };

  const placed: Placed[] = [];
  if (delta.includes("organization")) {
    const p1 = place(params.person.organizationName ?? "", clamp(front.organizationLine1), dpi);
    if (p1) placed.push(p1);
  }
  if (delta.includes("name")) {
    const f = place(params.person.firstName.toUpperCase(), clamp(front.firstName), dpi);
    const l = place(params.person.lastName, clamp(front.lastName), dpi);
    if (f) placed.push(f);
    if (l) placed.push(l);
  }
  if (delta.includes("title")) {
    const t = place(params.person.roleTitle, clamp(front.title), dpi);
    if (t) placed.push(t);
  }
  if (placed.length === 0) return { html: "", widthMm: stock.widthMm, heightMm: 0 };

  // ⚠️ The label's own extent, from what is actually on it — not a fixed size.
  // The roll is continuous, so cutting to the content is free and a shorter
  // label is less to misalign.
  const PAD = 24; // design px of breathing room, so glyphs are not on the cut line
  const top = Math.min(...placed.map((p) => p.top)) - PAD;
  const bottom = Math.max(...placed.map((p) => p.top + p.height)) + PAD;
  const widthPx = (stock.widthMm / 25.4) * dpi;
  const heightPx = bottom - top;
  // ⛔ CSS px are 1/96in; the slot geometry is in DESIGN px at the template's dpi
  // (300). Emitting design px straight into CSS lays the label out ~3x too large
  // and Chrome clips it — the first proof printed "FRED" instead of "FREDRICO".
  // render-html.ts carries a scaleX/scaleY for exactly this; this is the same
  // conversion for a one-slot page.
  const K = 96 / dpi;

  const body = placed
    .map((p) => {
      const fontPx = designPxFromPt(p.sizePt, dpi) * K;
      const family =
        p.slot.family === "primary"
          ? "var(--font-primary)"
          : p.slot.family === "secondary"
            ? "var(--font-secondary)"
            : "var(--font-slab)";
      const lines = p.lines
        .map(
          (line) =>
            `<div style="font-size:${fontPx}px;letter-spacing:${p.trackingEm}em;line-height:${p.lineHeightEm};">${escapeHtml(line)}</div>`
        )
        .join("");
      return `<div class="s" style="left:${(p.slot.x - bandX) * K}px;top:${(p.top - top) * K}px;width:${p.slot.width * K}px;font-family:${family};font-weight:${p.slot.weight};">${lines}</div>`;
    })
    .join("");

  const guides = params.showGuides
    ? `<div class="g" style="left:0;top:0;width:${widthPx * K}px;height:${heightPx * K}px;"></div>`
    : "";

  return {
    widthMm: stock.widthMm,
    heightMm: (heightPx / dpi) * 25.4,
    html: `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${TYPEKIT}" />
<style>
  @page { size: ${(widthPx / dpi).toFixed(4)}in ${(heightPx / dpi).toFixed(4)}in; margin: 0; }
  :root { --font-primary: ${template.fonts.primary}; --font-secondary: ${template.fonts.secondary}; --font-slab: ${template.fonts.slab}; }
  /* ⛔ Transparent, not white. The film is frosted clear — unprinted area shows
     the badge underneath, which is the entire point of the stock. */
  html,body { margin:0; padding:0; background:transparent; }
  .label { position:relative; width:${widthPx * K}px; height:${heightPx * K}px; overflow:hidden; }
  /* Thermal prints one colour. Anything not black is a lie about the output. */
  .s { position:absolute; color:#000; }
  .g { position:absolute; box-sizing:border-box; border:2px dashed #d0021b; }
</style></head><body><div class="label">${body}${guides}</div></body></html>`,
  };
}
