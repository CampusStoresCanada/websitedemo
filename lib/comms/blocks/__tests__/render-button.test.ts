import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/layout", () => ({ BRAND_NAVY: "#163D6D", BRAND_RED: "#EE2A2E", FONT: "Arial" }));

const { renderBlocksToHtml } = await import("../render");

/**
 * A button never floats: text after it starts below it, not beside it
 * (2026-11-05). The align lives on a full-width cell, not on the button's
 * own table, where align="left" makes it float.
 */
describe("button block", () => {
  for (const align of ["left", "center", "right"] as const) {
    it(`sits in its own full-width row when aligned ${align}`, () => {
      const html = renderBlocksToHtml([
        { id: "b", type: "button", text: "Go", href: "https://example.test", align, color: "#EE2A2E" },
      ] as never);
      expect(html).toContain('width="100%"');
      expect(html).toContain(`<td align="${align}"`);
      // No table carries the align attribute itself.
      expect(html).not.toMatch(/<table[^>]*\salign=/);
    });
  }
});
