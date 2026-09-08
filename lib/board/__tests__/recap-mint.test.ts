import { describe, it, expect } from "vitest";
import { parseRecapLines, groupRecapLines } from "@/lib/board/action-mint";

/**
 * The recap parser is the only thing in this codebase that EDITS the minutes.
 * A miss leaves a visible tag line someone can delete; an over-eager removal
 * deletes the board's record of a meeting. These tests mostly guard the second.
 */
describe("parseRecapLines", () => {
  it("leaves minutes without tags completely untouched", () => {
    const html = "<p>The meeting was called to order at 10:00.</p><p>ACTION: S. Thomas to send the deck.</p>";
    const out = parseRecapLines(html);
    expect(out.lines).toEqual([]);
    expect(out.strippedHtml).toBe(html);
    expect(out.removedHtml).toBe("");
  });

  it("parses the three tags and removes only their elements", () => {
    const html =
      "<p>Adjourned at 11:30.</p>" +
      "<p>DECIDED: Conference in a Box confirmed at $750.</p>" +
      "<p>OUTSTANDING: Venue still being compared.</p>" +
      "<p>NEXT MEETING: Big Ideas Day pricing.</p>";
    const out = parseRecapLines(html);

    expect(out.lines.map((l) => l.kind)).toEqual(["decided", "outstanding", "next_meeting"]);
    expect(out.lines[0].text).toBe("Conference in a Box confirmed at $750.");
    expect(out.strippedHtml).toBe("<p>Adjourned at 11:30.</p>");
    expect(out.removedHtml).toContain("DECIDED:");
  });

  it("keeps the tag verbatim in `raw` — the draft is the only surviving copy", () => {
    const out = parseRecapLines("<p>DECIDED: Rates locked.</p>");
    expect(out.lines[0].raw).toBe("DECIDED: Rates locked.");
    expect(out.lines[0].text).toBe("Rates locked.");
  });

  it("tolerates &nbsp; inside and around the tag", () => {
    const out = parseRecapLines("<p>NEXT&nbsp;MEETING:&nbsp;Town Hall recap.</p>");
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].kind).toBe("next_meeting");
    expect(out.lines[0].text).toBe("Town Hall recap.");
  });

  it("is case-insensitive", () => {
    const out = parseRecapLines("<p>decided: lowercase still counts.</p>");
    expect(out.lines[0].kind).toBe("decided");
  });

  it("removes a tagged <li> and drops the list left empty behind it", () => {
    const out = parseRecapLines("<p>Body.</p><ul><li>DECIDED: Only item.</li></ul>");
    expect(out.lines).toHaveLength(1);
    expect(out.strippedHtml).toBe("<p>Body.</p>");
    expect(out.strippedHtml).not.toContain("<ul>");
  });

  it("keeps sibling list items that carry no tag", () => {
    const out = parseRecapLines("<ul><li>Real minutes content.</li><li>DECIDED: Tagged.</li></ul>");
    expect(out.lines).toHaveLength(1);
    expect(out.strippedHtml).toContain("Real minutes content.");
    expect(out.strippedHtml).toContain("<ul>");
  });

  // The failure this guards is the whole reason removal is per-element rather
  // than "truncate from the first tag to the end of the document".
  it("does not swallow content that follows the tag block", () => {
    const html =
      "<p>DECIDED: Something.</p>" +
      "<p>Respectfully submitted, S. Thomas.</p>" +
      "<p>NEXT MEETING: Something else.</p>";
    const out = parseRecapLines(html);
    expect(out.lines).toHaveLength(2);
    expect(out.strippedHtml).toBe("<p>Respectfully submitted, S. Thomas.</p>");
  });

  it("preserves an @mention inside a tag line", () => {
    const out = parseRecapLines("<p>OUTSTANDING: Venue comparison. @Carolyn Potter</p>");
    expect(out.lines[0].text).toContain("@Carolyn Potter");
  });

  it("never touches ACTION lines", () => {
    const html = "<p>ACTION: S. Thomas to book the room by September 5.</p><p>DECIDED: Rates.</p>";
    const out = parseRecapLines(html);
    expect(out.lines).toHaveLength(1);
    expect(out.strippedHtml).toContain("ACTION:");
  });

  it("leaves a nested <div> wrapper structurally intact", () => {
    const out = parseRecapLines("<div><p>Kept.</p><p>DECIDED: Removed.</p></div>");
    expect(out.lines).toHaveLength(1);
    expect(out.strippedHtml).toBe("<div><p>Kept.</p></div>");
  });

  it("falls back to line stripping for plain-text minutes", () => {
    const out = parseRecapLines("Adjourned.\nDECIDED: Plain text works.\nOUTSTANDING: So does this.");
    expect(out.lines).toHaveLength(2);
    expect(out.strippedHtml).toBe("Adjourned.");
  });

  it("handles empty input without throwing", () => {
    expect(parseRecapLines("").lines).toEqual([]);
  });

  it("does not treat a mid-sentence mention of the word as a tag", () => {
    const out = parseRecapLines("<p>The board decided: nothing was formally moved.</p>");
    expect(out.lines).toEqual([]);
  });
});

describe("groupRecapLines", () => {
  it("groups by kind and preserves document order within each", () => {
    const out = parseRecapLines(
      "<p>DECIDED: One.</p><p>OUTSTANDING: Two.</p><p>DECIDED: Three.</p>"
    );
    const grouped = groupRecapLines(out.lines);
    expect(grouped.decided.map((l) => l.text)).toEqual(["One.", "Three."]);
    expect(grouped.outstanding.map((l) => l.text)).toEqual(["Two."]);
    expect(grouped.next_meeting).toEqual([]);
  });
});
