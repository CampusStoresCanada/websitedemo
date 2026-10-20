import { describe, expect, it } from "vitest";
import { combineStickerDocuments } from "../label-document";

/**
 * ⛔ One print job per reprint (Stephen, 2026-10-20) — but every sticker at its
 * OWN length. Sharing one page height wasted 27–46 mm of film per reprint.
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

describe("one print job for every sticker", () => {
  const html = combineStickerDocuments([
    { html: doc(62, 48, "FRONT"), widthMm: 62, heightMm: 48 },
    { html: doc(62, 96, "SCHEDULE"), widthMm: 62, heightMm: 96 },
    { html: doc(62, 21, "QR"), widthMm: 62, heightMm: 21 },
  ]);

  it("gives each sticker its own named page at its own length", () => {
    expect(html).toContain("@page p1 { size: 62mm 48mm; margin: 0; }");
    expect(html).toContain("@page p2 { size: 62mm 96mm; margin: 0; }");
    expect(html).toContain("@page p3 { size: 62mm 21mm; margin: 0; }");
  });

  it("keeps the stickers in order, one page each", () => {
    expect(html.indexOf("FRONT")).toBeLessThan(html.indexOf("SCHEDULE"));
    expect(html.indexOf("SCHEDULE")).toBeLessThan(html.indexOf("QR"));
    expect(html.match(/<section class="page-p\d">/g)).toHaveLength(3);
  });

  it("never lets one sticker's size overwrite another's", () => {
    expect(html).not.toMatch(/\.label\s*\{/);
    expect(html).toContain(".label-p2 { position:relative; width:62mm; height:96mm; }");
    expect(html).toContain('class="label-p3"');
  });

  it("drops a sticker with nothing on it", () => {
    const one = combineStickerDocuments([
      { html: doc(62, 48, "FRONT"), widthMm: 62, heightMm: 48 },
      { html: "", widthMm: 62, heightMm: 0 },
    ]);
    expect(one.match(/<section/g)).toHaveLength(1);
  });
});
