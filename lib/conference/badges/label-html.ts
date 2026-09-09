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
import {
  computeLabelPlacement,
  labelBandX,
  type Box,
} from "@/lib/conference/badges/label-placement";
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
  /** Where the fitted text actually sits. */
  top: number;
  height: number;
  /**
   * ⛔ Where the DESIGNED box sits — from the slot's defaultPt, not the fitted
   * size. This is what bounds the sticker.
   *
   * Sizing the sticker to the fitted text makes its position depend on how long
   * somebody's name is: a short name fits at a large size and starts high, a
   * long one shrinks and starts low. 📏 FREDRICO fits at 31.3pt against a 64pt
   * design, which put the sticker 109px — 9.2mm — below the box the designer
   * draws. Stephen spotted it as the sticker sitting too low on the card.
   *
   * The designed box is also STABLE, which matters more for a physical process
   * than for a rendering: every sticker is the same size, so the desk applies
   * them the same way every time and the stock estimate is a constant.
   */
  designedTop: number;
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
  const designedPx = designPxFromPt(slot.defaultPt, dpi);
  return {
    designedTop: slot.baselineY - designedPx * 0.8,
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
  person: {
    firstName: string; lastName: string; roleTitle: string;
    organizationName?: string;
    /** ⛔ Required when the delta carries `logo` — a spare has no branding. */
    logoUrl?: string | null;
  };
  template: BadgeTemplateConfigV1;
  delta: DeltaField[];
  stock: ReprintStock;
  /**
   * Left edge of the sticker on the badge, in design px.
   *
   * ⚠️ Defaults to the same centred value computeLabelPlacement uses. Passing a
   * different one puts the text somewhere the sticker is not.
   */
  bandX?: number;
  /**
   * ⛔ WHICH SIDE. A reprint onto a company blank needs TWO labels, not one.
   *
   * The blank carries everything that is true of the ORGANISATION — its name,
   * logo, map, and on the back its registration type's schedule and the venue.
   * What it cannot carry is anything true of a PERSON, because no person was
   * named to it when it printed. On the front that is the name and title; on the
   * back it is the badge QR, which is derived per person from their token row
   * and is unique to them on every badge in the run.
   *
   * ⚠️ Miss the back label and the reprint LOOKS complete — right name, right
   * company, right schedule — and scans as nothing. That is worse than an
   * obviously blank card, because nobody checks a badge that looks finished.
   */
  side?: "front" | "back";
  /** The person's badge QR, already encoded. Back labels only. */
  qrDataUri?: string | null;
  /**
   * ⚠️ Normally UNUSED and that is correct. The qr_caption line is invariant
   * chrome and now prints on the blank itself, so the back sticker carries the
   * QR alone. Kept for a conference whose caption is not on its blanks.
   */
  qrCaption?: string | null;
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
  /**
   * ⛔ The overlay's reserved plates, so the label can be kept off them.
   *
   * Without these the placement has no idea the QR plate exists and will happily
   * size a label straight over it — measured: 543+545 = 1088 against a plate
   * starting at 1066. A label over a QR is a badge that stops scanning at a door.
   * Read them with reservedPlatesFromOverlay(); do not retype the coordinates.
   */
  reserved?: Box[];
}): { html: string; widthMm: number; heightMm: number; placement?: ReturnType<typeof computeLabelPlacement> } {
  const { template, delta, stock } = params;
  const dpi = template.canvas.dpi;
  /**
   * ⛔ ONE rule for the band's left edge, shared with computeLabelPlacement:
   * the leftmost thing the label draws, less the cut margin.
   *
   * ⚠️ This used to be its own centred calculation while the placement used the
   * rail — two answers to one question, which is why the ink kept landing on the
   * cut line even after the placement was given a margin. Third time this file
   * has grown a second copy of a number that lives elsewhere.
   */
  const bandX = params.bandX ?? labelBandX(template.front, delta, dpi);
  const front = template.front;
  /**
   * ⛔ EVERY SLOT KEEPS ITS OWN x. `anchorTextToEdge` is honoured only for slots
   * already sitting on the band's left edge, which since the unified layout is
   * where the name and title live anyway.
   *
   * ⚠️ Blanket re-anchoring was correct exactly once: when the badge hung its
   * name text at x=44, left of everything else, and a sticker starting there
   * overhung the card. The unified rail removed that problem and made the hack
   * destructive — the organisation name sits BESIDE the logo at x=378, so
   * forcing it to the rail printed "McMaster University" straight across the
   * McMaster crest. Caught by rendering a spare, which is the only case that
   * carries both.
   */
  const clamp = (s: BadgeSlotText) => {
    // ⛔ Slots always keep their own x now. The band starts LEFT of the rail by
    // the cut margin, so a slot on the rail already renders with air beside it —
    // re-anchoring would pull it back onto the cut.
    return clampSlotToStock(s, { bandX, stock, dpi });
  };

  // ── BACK LABEL ────────────────────────────────────────────────────────────
  // ⛔ Rendered from the BACK slots at their own coordinates, same principle as
  // the front: the sticker joins a card that already exists, so it has to land
  // where that card's design put the QR.
  if (params.side === "back") {
    const backCfg = template.back;
    const qr = backCfg.qr;
    if (!params.qrDataUri) {
      // ⛔ No payload, no label. A back label with no QR is a blank sticker
      // applied over a blank area — it looks like the reprint was completed.
      return { html: "", widthMm: stock.widthMm, heightMm: 0 };
    }
    const bandX = Math.min(qr.x, ...(backCfg.blocks ?? []).map((b) => b.x));
    const K2 = 96 / dpi;
    const widthPx2 = (stock.widthMm / 25.4) * dpi;
    const PAD2 = 16;
    const caption = (params.qrCaption ?? "").trim();
    const capBlock = (backCfg.blocks ?? []).find((b) => b.source === "qr_caption");
    const capPt = capBlock?.sizePt ?? 7;
    const capPx = designPxFromPt(capPt, dpi);
    const top2 = qr.y - PAD2;
    const bottom2 = caption && capBlock
      ? Math.max(qr.y + qr.size, capBlock.y + capPx * 1.3) + PAD2
      : qr.y + qr.size + PAD2;
    const h2 = bottom2 - top2;
    const capHtml = caption && capBlock
      ? `<div class="s" style="left:${(capBlock.x - bandX) * K2}px;top:${(capBlock.y - top2) * K2}px;` +
        `width:${Math.max(0, Math.min(capBlock.width, bandX + widthPx2 - capBlock.x)) * K2}px;` +
        `font-family:var(--font-primary);font-size:${capPx * K2}px;line-height:1.2;">${escapeHtml(caption)}</div>`
      : "";
    return {
      widthMm: stock.widthMm,
      heightMm: (h2 / dpi) * 25.4,
      html: `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${TYPEKIT}" />
<style>
  @page { size: ${(widthPx2 / dpi).toFixed(4)}in ${(h2 / dpi).toFixed(4)}in; margin: 0; }
  :root { --font-primary: ${template.fonts.primary}; }
  html,body { margin:0; padding:0; background:transparent; }
  .label { position:relative; width:${widthPx2 * K2}px; height:${h2 * K2}px; overflow:hidden; }
  .s { position:absolute; color:#000; }
  /* ⛔ White plate behind the QR. On frosted clear film the badge shows through,
     and a QR needs its quiet zone opaque or the map behind it kills contrast. */
  .qrp { position:absolute; background:#fff; }
  .qr { position:absolute; }
</style></head><body><div class="label">
  <div class="qrp" style="left:${(qr.x - bandX - 8) * K2}px;top:${(qr.y - top2 - 8) * K2}px;width:${(qr.size + 16) * K2}px;height:${(qr.size + 16) * K2}px;"></div>
  <img class="qr" src="${params.qrDataUri}" alt="" style="left:${(qr.x - bandX) * K2}px;top:${(qr.y - top2) * K2}px;width:${qr.size * K2}px;height:${qr.size * K2}px;" />
  ${capHtml}
</div></body></html>`,
    };
  }

  // ⛔ Only when the delta asks AND the org actually has a mark. A missing logo
  // prints nothing rather than a placeholder circle: on a spare there is no
  // white disc underneath, so an empty circle would be a drawn hole.
  const wantsLogo = delta.includes("logo") && Boolean(params.person.logoUrl);

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

  // ⛔ ONE placement implementation. The box comes from label-placement.ts —
  // the same function the pipeline uses to decide where the sticker goes on the
  // card — so the label that gets printed and the position it gets applied at
  // can never disagree. Computing bounds here as well is how a renderer and a
  // placer drift apart by 9mm and nobody notices until it is on a card.
  const placement = computeLabelPlacement({
    template,
    front,
    delta,
    stock,
    contentBottoms: placed.map((p) => p.top + p.height),
    reserved: params.reserved,
    logoBox: wantsLogo
      ? { x: front.logo.x, y: front.logo.y, width: front.logo.diameter, height: front.logo.diameter }
      : null,
  });
  if (placement.problem) return { html: "", widthMm: stock.widthMm, heightMm: 0, placement };
  const top = placement.box.y;
  const widthPx = placement.box.width;
  const heightPx = placement.box.height;
  // ⛔ CSS px are 1/96in; slot geometry is DESIGN px at the template's dpi.
  // Emitting design px straight into CSS lays the label out ~3x too large and
  // Chrome clips it — the first proof printed "FRED" instead of "FREDRICO".
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

  /**
   * ⚠️ GREYSCALE, HIGH CONTRAST. Thermal prints one colour: the printer will
   * dither a colour mark to black whatever we send it. Rendering it that way
   * here means the proof shows what comes out of the QL rather than a colour
   * logo that cannot exist on this stock.
   */
  const logoHtml = wantsLogo
    ? `<img class="lg" src="${escapeHtml(params.person.logoUrl as string)}" alt="" ` +
      `style="left:${(front.logo.x - bandX) * K}px;top:${(front.logo.y - top) * K}px;` +
      `width:${front.logo.diameter * K}px;height:${front.logo.diameter * K}px;" />`
    : "";

  const guides = params.showGuides
    ? `<div class="g" style="left:0;top:0;width:${widthPx * K}px;height:${heightPx * K}px;"></div>`
    : "";

  return {
    placement,
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
  /* Thermal is one colour; show the mark as the printer will render it. */
  .lg { position:absolute; object-fit:contain; filter:grayscale(1) contrast(1.6); }
</style></head><body><div class="label">${logoHtml}${body}${guides}</div></body></html>`,
  };
}
