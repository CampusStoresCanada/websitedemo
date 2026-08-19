import { describe, it, expect } from "vitest";
import {
  extractActionLines,
  resolveOwners,
  grade,
  extractDueDateText,
  proposeFromMinutes,
  rewriteMentions,
  stripMinutesHtml,
  type DirectoryEntry,
} from "@/lib/board/action-mint";

/** The real board + staff directory: twelve people, twelve distinct surnames. */
const DIRECTORY: DirectoryEntry[] = [
  { id: "u-thomas", displayName: "Stephen Thomas" },
  { id: "u-mcpherson", displayName: "Greg McPherson" },
  { id: "u-potter", displayName: "Carolyn Potter" },
  { id: "u-may", displayName: "Imelda May" },
  { id: "u-kack", displayName: "Jason Kack" },
  { id: "u-stonehouse", displayName: "Karin Stonehouse" },
  { id: "u-liu", displayName: "Kevin Liu" },
  { id: "u-willis", displayName: "Sam Willis" },
  { id: "u-bell", displayName: "Sean Bell" },
  { id: "u-blackadder", displayName: "Shannon Blackadder" },
  { id: "u-davies", displayName: "Shawn Davies" },
  { id: "u-linden", displayName: "Trish Linden-Teasdale" },
];

describe("stripMinutesHtml", () => {
  it("strips tags and decodes the entity runs the minutes are full of", () => {
    const html = "<p>ACTION: &nbsp;&nbsp;&nbsp; S. Thomas to remove CEI&#39;s access.</p>";
    expect(stripMinutesHtml(html)).toBe("ACTION: S. Thomas to remove CEI's access.");
  });
});

describe("extractActionLines", () => {
  it("pulls a single action and drops the trailing agenda number", () => {
    const html =
      "<p>ACTION: &nbsp;&nbsp; S. Thomas to remove CEI's access to Circle. &nbsp; 7.&nbsp; Ambassador Education</p>";
    expect(extractActionLines(html)).toEqual([
      "S. Thomas to remove CEI's access to Circle",
    ]);
  });

  it("pulls several actions from one document", () => {
    const html = `
      <p>ACTION: @Jason Kack to respond to Brent at CEI by June 30, 2026.</p>
      <p>Some discussion text that is not an action at all.</p>
      <p>ACTION: S. Blackadder to invite Ambassador Education Solutions to present.</p>`;
    const lines = extractActionLines(html);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Jason Kack");
    expect(lines[1]).toContain("Blackadder");
  });

  it("is case-insensitive on the marker and tolerates spacing", () => {
    expect(extractActionLines("<p>Action : G. McPherson to send the report</p>")).toEqual([
      "G. McPherson to send the report",
    ]);
  });

  it("returns nothing for minutes with no actions", () => {
    expect(extractActionLines("<p>The board discussed the budget at length.</p>")).toEqual([]);
  });

  it("stops at a multi-level agenda heading", () => {
    // Real June 23 minutes: the action ran on into section 8.4 because the
    // terminator only understood single-level numbers.
    const html =
      "<p>ACTION: S. Thomas to bring finalized pricing back to the Board by June 30, 2026. 8.4 JCWG Toronto Retail Store Tour Proposal The Board did not reach this item.</p>";
    const [line] = extractActionLines(html);
    expect(line).toBe(
      "S. Thomas to bring finalized pricing back to the Board by June 30, 2026"
    );
    expect(line).not.toContain("JCWG");
  });

  it("stops at an agenda heading whose title begins with a number", () => {
    // Real June 23 minutes: "poll.    8.    2027 Conference Planning"
    const html =
      "<p>ACTION: S. Blackadder to invite Ambassador Education Solutions and to coordinate a date via a poll. 8. 2027 Conference Planning 8.1 Venue Floorplan Mock-up</p>";
    const [line] = extractActionLines(html);
    expect(line).toBe(
      "S. Blackadder to invite Ambassador Education Solutions and to coordinate a date via a poll"
    );
  });

  it("caps a runaway action when the minutes have no numbered headings", () => {
    const tail = "Further discussion continued at length. ".repeat(40);
    const html = `<p>ACTION: S. Thomas to confirm final details with the Hilton. ${tail}</p>`;
    const [line] = extractActionLines(html);
    expect(line.length).toBeLessThanOrEqual(400);
    expect(line).toContain("confirm final details with the Hilton");
  });

  it("does not truncate on a decimal or an inline list number", () => {
    const html = "<p>ACTION: S. Thomas to confirm the 3.5 percent increase and send the notice</p>";
    expect(extractActionLines(html)[0]).toContain("3.5 percent");
  });
});

describe("resolveOwners", () => {
  it("resolves initial + surname", () => {
    const r = resolveOwners("S. Thomas", DIRECTORY);
    expect(r.ids).toEqual(["u-thomas"]);
    expect(r.collective).toBe(false);
  });

  it("resolves an existing @mention", () => {
    expect(resolveOwners("@Jason Kack", DIRECTORY).ids).toEqual(["u-kack"]);
  });

  it("resolves a bare surname", () => {
    expect(resolveOwners("Stonehouse", DIRECTORY).ids).toEqual(["u-stonehouse"]);
  });

  it("resolves a hyphenated surname", () => {
    expect(resolveOwners("T. Linden-Teasdale", DIRECTORY).ids).toEqual(["u-linden"]);
  });

  it("survives the first-name aliases that break naive matching", () => {
    // Kevin Liu logs in as huikai.liu@; Trish appears as patricia elsewhere.
    expect(resolveOwners("K. Liu", DIRECTORY).ids).toEqual(["u-liu"]);
    expect(resolveOwners("P. Linden-Teasdale", DIRECTORY).ids).toEqual(["u-linden"]);
  });

  it("splits compound owners on and, ampersand and slash", () => {
    expect(resolveOwners("K. Liu and T. Linden-Teasdale", DIRECTORY).ids).toEqual([
      "u-liu",
      "u-linden",
    ]);
    expect(resolveOwners("G. McPherson & S. Thomas", DIRECTORY).ids).toEqual([
      "u-mcpherson",
      "u-thomas",
    ]);
    expect(resolveOwners("S. Thomas / C. Potter", DIRECTORY).ids).toEqual([
      "u-thomas",
      "u-potter",
    ]);
  });

  it("flags collective owners rather than fanning out to everyone", () => {
    for (const text of ["Board", "The Board", "All Board Members"]) {
      const r = resolveOwners(text, DIRECTORY);
      expect(r.collective).toBe(true);
      expect(r.ids).toEqual([]);
    }
  });

  it("never guesses when a surname is ambiguous", () => {
    const twoThomases = [...DIRECTORY, { id: "u-other", displayName: "Terry Thomas" }];
    const r = resolveOwners("S. Thomas", twoThomases);
    expect(r.ids).toEqual([]);
    expect(r.unresolved).toEqual(["S. Thomas"]);
  });

  it("falls back to a first name when the surname matches nobody", () => {
    // Real minutes say "S. Thomas and Carolyn". All twelve first names are
    // distinct, so this is as safe as surname matching.
    expect(resolveOwners("Carolyn", DIRECTORY).ids).toEqual(["u-potter"]);
    expect(resolveOwners("S. Thomas and Carolyn", DIRECTORY).ids).toEqual([
      "u-thomas",
      "u-potter",
    ]);
  });

  it("reports an unknown name as unresolved", () => {
    expect(resolveOwners("A. Stranger", DIRECTORY).unresolved).toEqual(["A. Stranger"]);
  });
});

describe("extractDueDateText", () => {
  it.each([
    ["bring pricing back by June 30, 2026", "by June 30, 2026"],
    ["deliver this by the next board meeting", "by the next board meeting"],
    ["finish by end of March 2026", "end of March 2026"],
    ["provide projections within two weeks", null], // spelled-out counts aren't dates
    ["provide projections within 2 weeks", "within 2 weeks"],
  ])("parses %s", (input, expected) => {
    expect(extractDueDateText(input)).toBe(expected);
  });

  it("returns null when there is no date", () => {
    expect(extractDueDateText("remove CEI's access to Circle")).toBeNull();
  });
});

describe("grade — the three tests", () => {
  function gradeLine(line: string) {
    const [proposal] = proposeFromMinutes(`<p>ACTION: ${line}</p>`, DIRECTORY);
    return proposal;
  }

  it("passes an owned, completable, observable action", () => {
    const p = gradeLine("S. Thomas to remove CEI's access to Circle");
    expect(p.flags).toEqual([]);
    expect(p.isAction).toBe(true);
    expect(p.ownerIds).toEqual(["u-thomas"]);
  });

  it("passes a dated deliverable", () => {
    const p = gradeLine(
      "S. Thomas to bring finalized pricing back to the Board by June 30, 2026"
    );
    expect(p.isAction).toBe(true);
    expect(p.dueDateText).toBe("by June 30, 2026");
  });

  it("fails all three on a collective standing wish", () => {
    const p = gradeLine("Board to continue to promote CSC membership");
    expect(p.isAction).toBe(false);
    expect(p.flags).toContain("no_owner");
    expect(p.flags).toContain("uncompletable_verb");
    expect(p.flags).toContain("no_finish_line");
  });

  it("fails vague timing even with a named owner", () => {
    const p = gradeLine("S. Thomas to revisit the pricing model at a future meeting");
    expect(p.isAction).toBe(false);
    expect(p.flags).toContain("no_finish_line");
  });

  it("fails a collective item that is otherwise well formed", () => {
    const p = gradeLine("The Board to send the sponsorship ask by June 30, 2026");
    expect(p.isAction).toBe(false);
    expect(p.flags).toEqual(["no_owner"]);
  });

  // The decision that discuss/review stay on the fail list only works if the
  // test scores on ANY completable verb rather than the leading one.
  it("rescues a compound item whose lead verb is uncompletable", () => {
    const p = gradeLine(
      "S. Thomas to review the draft policy and report back by June 30, 2026"
    );
    expect(p.isAction).toBe(true);
    expect(p.flags).not.toContain("uncompletable_verb");
  });

  it("treats standing work as an intention, not a task", () => {
    // "announce" is completable, but "consistently" makes it a practice with
    // no finish line.
    const p = gradeLine("S. Thomas to announce new members in Circle consistently");
    expect(p.isAction).toBe(false);
    expect(p.flags).toContain("no_finish_line");
  });

  it("still fails a review with nothing arriving", () => {
    const p = gradeLine("S. Thomas to review our approach to advocacy");
    expect(p.isAction).toBe(false);
    expect(p.flags).toContain("uncompletable_verb");
  });
});

describe("proposeFromMinutes", () => {
  it("separates owner from action and keeps the excerpt for traceability", () => {
    const [p] = proposeFromMinutes(
      "<p>ACTION: S. Blackadder to invite Ambassador Education Solutions to present to the Board</p>",
      DIRECTORY
    );
    expect(p.ownerText).toBe("S. Blackadder");
    expect(p.title).toBe("Invite Ambassador Education Solutions to present to the Board");
    expect(p.sourceExcerpt).toContain("S. Blackadder to invite");
  });
});

describe("rewriteMentions", () => {
  it("swaps initial+surname for a canonical mention", () => {
    expect(rewriteMentions("<p>S. Thomas to remove access.</p>", DIRECTORY)).toBe(
      "<p>@Stephen Thomas to remove access.</p>"
    );
  });

  it("swaps a full name", () => {
    expect(rewriteMentions("Greg McPherson will report.", DIRECTORY)).toBe(
      "@Greg McPherson will report."
    );
  });

  it("leaves an existing mention alone rather than doubling the @", () => {
    expect(rewriteMentions("@Jason Kack to respond.", DIRECTORY)).toBe(
      "@Jason Kack to respond."
    );
  });

  it("leaves an ambiguous surname untouched", () => {
    const twoThomases = [...DIRECTORY, { id: "u-other", displayName: "Terry Thomas" }];
    expect(rewriteMentions("S. Thomas to act.", twoThomases)).toBe("S. Thomas to act.");
  });
});
