import { describe, expect, it } from "vitest";

/**
 * ⛔ A spare's back is ONE sticker: the schedule above the QR, each at its
 * place on the card. Every reprint is two stickers, front and back.
 */
const doc = (w: number, h: number, inner: string) =>
  `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://use.typekit.net/x.css" />
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  :root { --font-primary: A; --font-secondary: B; }
  html,body { margin:0; padding:0; background:transparent; }
  .label { position:relative; width:${w}mm; height:${h}mm; }
  .s { position:absolute; }
</style></head><body><div class="label">${inner}</div></body></html>`;


import { stackStickerParts } from "../label-document";
import { stickersFor } from "../reprint-plan";

describe("a spare's back: schedule and QR on one sticker", () => {
  const html = stackStickerParts({
    widthMm: 62,
    heightMm: 120,
    parts: [
      { html: doc(62, 96, "SCHEDULE"), xMm: 0, yMm: 0 },
      { html: doc(62, 21, "QR"), xMm: 1.4, yMm: 100 },
    ],
  });

  it("is one page, the full height, with each part at its place on the card", () => {
    expect(html).toContain("@page { size: 62mm 120mm; margin: 0; }");
    expect(html).toContain('style="position:absolute;left:1.4mm;top:100mm;"');
    expect(html.match(/@page/g)).toHaveLength(1);
  });

  it("keeps each part's own size", () => {
    expect(html).toContain(".label-s1 { position:relative; width:62mm; height:96mm; }");
    expect(html).toContain(".label-s2 { position:relative; width:62mm; height:21mm; }");
  });

  it("is always two stickers: front and back, never three", () => {
    expect(stickersFor({ transport: "ql_label", delta: ["name", "title", "qr", "organization", "logo", "schedule"] })).toEqual(["front", "back"]);
    expect(stickersFor({ transport: "ql_label", delta: ["name", "title", "qr"] })).toEqual(["front", "back"]);
    expect(stickersFor({ transport: "full_badge_pdf", delta: [] })).toEqual([]);
  });
});
