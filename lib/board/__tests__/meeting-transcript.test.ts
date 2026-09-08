import { describe, it, expect } from "vitest";
import { extractPlainText } from "@/lib/board/meeting-transcript";
import type { NotionBlock } from "@/lib/notion/client";

const block = (type: string, text: string): NotionBlock => ({
  id: `blk_${type}_${text.slice(0, 6)}`,
  type,
  [type]: { rich_text: [{ plain_text: text }] },
});

/**
 * The transcript block's exact shape is unknown until a real meeting is
 * recorded, so these pin the behaviour that matters: unfamiliar shapes must
 * degrade to a gap, never an exception.
 */
describe("extractPlainText", () => {
  it("flattens text-bearing blocks one per line", () => {
    const out = extractPlainText([
      block("paragraph", "Shannon called the meeting to order."),
      block("paragraph", "Stephen reported on registration."),
    ]);
    expect(out).toBe("Shannon called the meeting to order.\nStephen reported on registration.");
  });

  it("reads any block type that carries rich_text", () => {
    const out = extractPlainText([
      block("heading_2", "Conference Planning"),
      block("bulleted_list_item", "Venue still open"),
      block("transcript_entry", "We should lock the dates."),
    ]);
    expect(out).toContain("Conference Planning");
    expect(out).toContain("Venue still open");
    expect(out).toContain("We should lock the dates.");
  });

  it("joins split rich-text runs into one line", () => {
    const out = extractPlainText([
      { id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Big " }, { plain_text: "Ideas Day" }] } },
    ]);
    expect(out).toBe("Big Ideas Day");
  });

  it("ignores blocks with no rich_text rather than throwing", () => {
    const out = extractPlainText([
      { id: "b1", type: "divider", divider: {} },
      { id: "b2", type: "image", image: { file: { url: "https://x" } } },
      { id: "b3", type: "unknown_future_type" },
      block("paragraph", "Survives."),
    ]);
    expect(out).toBe("Survives.");
  });

  it("drops empty and whitespace-only lines", () => {
    const out = extractPlainText([
      block("paragraph", "   "),
      block("paragraph", ""),
      block("paragraph", "Real content."),
    ]);
    expect(out).toBe("Real content.");
  });

  it("returns an empty string for no blocks", () => {
    expect(extractPlainText([])).toBe("");
  });
});
