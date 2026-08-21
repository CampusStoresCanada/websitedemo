import { describe, expect, it } from "vitest";
import { exhibitorCodeUrl, qrSvg } from "../qr";

describe("exhibitorCodeUrl", () => {
  it("builds the permanent /e/<code> URL", () => {
    expect(exhibitorCodeUrl("https://campusstores.ca", "508C5511"))
      .toBe("https://campusstores.ca/e/508C5511");
  });

  it("tolerates a trailing slash on the base", () => {
    // A double slash still resolves, but it prints into the QR and makes the
    // code denser for no reason.
    expect(exhibitorCodeUrl("https://campusstores.ca/", "508C5511"))
      .toBe("https://campusstores.ca/e/508C5511");
  });
});

describe("qrSvg", () => {
  it("returns inline SVG with no XML prolog, so it drops into markup", async () => {
    const svg = await qrSvg("https://campusstores.ca/e/508C5511");
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<?xml");
  });

  it("keeps the 4-module quiet zone — trimming it is why printed codes fail", async () => {
    const svg = await qrSvg("https://campusstores.ca/e/508C5511");
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(viewBox).not.toBeNull();
    // Quiet zone is 4 modules each side, so the viewBox exceeds the symbol by 8.
    expect(Number(viewBox![1])).toBeGreaterThanOrEqual(8 + 21);
  });

  it("stays sparse enough to scan small — a short code is the whole point", async () => {
    const short = await qrSvg("https://campusstores.ca/e/508C5511");
    const long = await qrSvg("https://campusstores.ca/org/some-quite-long-organization-slug/conference/7e650b08-51d1-4573-a332-7d6b6fbc50bd");
    const modules = (s: string) => Number(/viewBox="0 0 (\d+)/.exec(s)![1]);
    expect(modules(short)).toBeLessThan(modules(long));
  });

  it("is deterministic — the same code prints the same symbol every run", async () => {
    const a = await qrSvg("https://campusstores.ca/e/508C5511");
    const b = await qrSvg("https://campusstores.ca/e/508C5511");
    expect(a).toBe(b);
  });
});
