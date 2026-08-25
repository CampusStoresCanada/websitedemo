import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { composePublication, type Publication, type PublicationAd } from "../composition";
import { toInDesignXml } from "../indesign";
import { parsePublication } from "../store";

/**
 * Advertising slots — quarter, half and full page.
 *
 * The load-bearing idea is that an UNSOLD slot is not an absence. Space is sold
 * against a page count, so the book has to be layoutable before anything is
 * sold; a slot that vanishes when it has no artwork silently changes how long
 * the book is.
 */
const pub = (ads: PublicationAd[]): Publication => ({
  id: "p", title: "Directory",
  source: { kind: "organizations", orgType: "Member" },
  selection: {},
  sections: [{ type: "ads", title: "Advertising", ads }],
});

const xmlFor = (ads: PublicationAd[]) => toInDesignXml(composePublication(pub(ads), []));

describe("the three sizes", () => {
  it("carries each size through to the export", () => {
    const xml = xmlFor([{ size: "quarter" }, { size: "half" }, { size: "full" }]);
    expect(xml).toContain('size="quarter"');
    expect(xml).toContain('size="half"');
    expect(xml).toContain('size="full"');
  });

  it("gives each size its own printed dimensions", () => {
    // What is sold is an area on a page, so the print rules must be in real
    // units, not a proportion of a browser window.
    const css = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(css).toMatch(/\.pub-ad--full[^}]*height: 245mm/);
    expect(css).toMatch(/\.pub-ad--half[^}]*height: 120mm/);
    expect(css).toMatch(/\.pub-ad--quarter[^}]*height: 120mm/);
  });

  it("lays slots out on a two-column grid, not flex", () => {
    // Measured: as flex, two "50% minus gap" quarters totalled exactly the row
    // width and sub-pixel rounding wrapped them one per line — a quarter page
    // silently occupying half a page, and the book running long.
    const css = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(css).toMatch(/\.pub-ads \{[^}]*grid-template-columns: repeat\(2, 1fr\)/);
    expect(css).not.toMatch(/\.pub-ad--quarter \{[^}]*width: calc/);
    expect(css).toMatch(/\.pub-ad--full[^}]*grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.pub-ad--half[^}]*grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.pub-ad--quarter[^}]*grid-column: span 1/);
  });

  it("gives a full page its own page", () => {
    const css = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(css).toMatch(/\.pub-ad--full[^}]*break-before: page/);
    expect(css).toMatch(/\.pub-ad--full[^}]*break-after: page/);
  });
});

describe("unsold slots hold their space", () => {
  it("still exports, marked unsold", () => {
    const xml = xmlFor([{ size: "half" }]);
    expect(xml).toContain('sold="false"');
    expect(xml).not.toContain("href=");
  });

  it("marks a sold slot and carries its artwork", () => {
    const xml = xmlFor([{ size: "half", imageUrl: "https://x.test/ad.png", advertiser: "Acme" }]);
    expect(xml).toContain('sold="true"');
    expect(xml).toContain('href="https://x.test/ad.png"');
    expect(xml).toContain('advertiser="Acme"');
  });

  it("does not count an unsold slot as an empty section", () => {
    // Empty sections are dropped from print. A reserved slot must survive that,
    // or the page it was holding disappears.
    const source = readFileSync("components/publication/PublicationView.tsx", "utf8");
    const fn = source.slice(source.indexOf("function isEmptySection"), source.indexOf("function Section("));
    expect(fn).toContain("section.ads.length === 0");
  });

  it("renders a labelled placeholder rather than nothing", () => {
    const source = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(source).toContain("pub-ad-open");
    expect(source).toContain("available");
  });
});

describe("stored definitions", () => {
  const row = (ads: unknown) => ({
    id: "p", name: "n", title: "T",
    source: { kind: "organizations", orgType: "Member" },
    selection: {},
    sections: [{ type: "ads", title: "Advertising", ads }],
  });

  it("round-trips sold and unsold slots", () => {
    const parsed = parsePublication(row([
      { size: "full", imageUrl: "https://x.test/a.png", advertiser: "Acme", alt: "Acme advert" },
      { size: "quarter" },
    ]));
    expect(parsed?.rejected).toEqual([]);
    const section = parsed?.publication.sections[0];
    expect(section?.type === "ads" && section.ads).toHaveLength(2);
    expect(section?.type === "ads" && section.ads[1].imageUrl).toBeNull();
  });

  it("drops a slot with an unknown size but keeps the rest of the page", () => {
    // A size the layout has no dimensions for cannot be placed at all; losing
    // the page around it would be a much bigger failure.
    const parsed = parsePublication(row([{ size: "billboard" }, { size: "half" }]));
    const section = parsed?.publication.sections[0];
    expect(section?.type === "ads" && section.ads).toHaveLength(1);
    expect(parsed?.rejected.join(" ")).toContain("invalid size");
  });

  it("rejects an ads section with no ads array rather than printing a bare heading", () => {
    const parsed = parsePublication(row(undefined));
    expect(parsed?.publication.sections).toHaveLength(0);
    expect(parsed?.rejected.join(" ")).toContain("no ads array");
  });
});
