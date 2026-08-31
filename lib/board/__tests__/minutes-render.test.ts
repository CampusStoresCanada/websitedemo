import { describe, it, expect } from "vitest";
import { renderMinutesHtml } from "@/lib/board/minutes-render";
import { parseRecapLines, groupRecapLines } from "@/lib/board/action-mint";
import type { MinutesData } from "@/lib/board/minutes-schema";

const data: MinutesData = {
  meetingTitle: "CSC Board Meeting",
  meetingDateLong: "Thursday, September 24, 2026",
  footerDate: "September 24, 2026",
  present: ["Shannon Blackadder, Stephen Thomas", "", "Greg McPherson, Executive Director"],
  absent: ["Shawn Davies"],
  blocks: [
    { type: "sectionHeading", text: "BUSINESS ITEMS" },
    { type: "item", num: "1", title: "Call to Order" },
    { type: "body", text: "S. Blackadder called the meeting to order.", indent: 720 },
    { type: "motion", lines: [
      { text: "In a motion duly moved and seconded, it was resolved that:", underline: true },
      { text: "The agenda be approved as circulated." },
      { text: "The Motion was carried." },
    ] },
    { type: "action", label: "ACTION", text: "S. Thomas to circulate the numbers." },
  ],
  recap: {
    decided: ["Agenda approved as circulated."],
    outstanding: ["Venue still open. @Carolyn Potter"],
    nextMeeting: ["Benchmarking, carried forward."],
  },
  assumptions: [],
};

describe("renderMinutesHtml", () => {
  it("renders the skill's own HTML conventions", () => {
    const html = renderMinutesHtml(data);
    expect(html).toContain("<h1><strong>BUSINESS ITEMS</strong></h1>");
    expect(html).toContain("<h2><strong>1.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<u>In a motion duly moved and seconded, it was resolved that:</u>");
    expect(html).toContain("<strong>ACTION:</strong>");
  });

  // The whole chain in one assertion: what the model drafts must be readable by
  // the save route that consumes the tags.
  it("emits recap tags the website's own parser can consume", () => {
    const html = renderMinutesHtml(data);
    const parsed = parseRecapLines(html);
    const grouped = groupRecapLines(parsed.lines);

    expect(parsed.lines).toHaveLength(3);
    expect(grouped.decided[0].text).toBe("Agenda approved as circulated.");
    expect(grouped.outstanding[0].text).toContain("@Carolyn Potter");
    expect(grouped.next_meeting[0].text).toBe("Benchmarking, carried forward.");

    // And stripping them leaves the minutes intact.
    expect(parsed.strippedHtml).toContain("<blockquote>");
    expect(parsed.strippedHtml).not.toContain("DECIDED:");
  });
});
