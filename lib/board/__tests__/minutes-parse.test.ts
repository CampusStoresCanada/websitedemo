import { describe, it, expect } from "vitest";
import { parseMinutesHtml } from "@/lib/board/minutes-parse";
import { renderMinutesHtml } from "@/lib/board/minutes-render";
import type { MinutesData } from "@/lib/board/minutes-schema";
import example from "../../../skills/csc-board-minutes/scripts/example_data.json";

// Indents the .docx builder applies when a block carries none.
const DEFAULT_INDENT: Record<string, number> = { body: 720, bullet: 1080, action: 0 };

function withIndents(blocks: Array<Record<string, unknown>>) {
  return blocks.map((b) => {
    const type = String(b.type);
    return type in DEFAULT_INDENT ? { ...b, indent: b.indent ?? DEFAULT_INDENT[type] } : b;
  });
}

describe("parseMinutesHtml", () => {
  const data = { recap: { decided: [], outstanding: [], nextMeeting: [] }, assumptions: [], ...example } as MinutesData;
  const parsed = parseMinutesHtml(renderMinutesHtml(data));

  it("round-trips the skill's example minutes through build_html.js", () => {
    expect(withIndents(parsed.blocks)).toEqual(withIndents(data.blocks));
  });

  it("recovers the header and the board/staff spacer the HTML drops", () => {
    expect(parsed.meetingTitle).toBe(data.meetingTitle);
    expect(parsed.meetingDateLong).toBe(data.meetingDateLong);
    expect(parsed.footerDate).toBe(data.footerDate);
    expect(parsed.present).toEqual(data.present);
    expect(parsed.absent).toEqual(data.absent);
  });

  it("drops recap tags — they are machinery, never minutes content", () => {
    const html = renderMinutesHtml({ ...data, recap: { decided: ["X."], outstanding: ["Y."], nextMeeting: ["Z."] } });
    expect(parseMinutesHtml(html).blocks).toEqual(parsed.blocks);
  });

  it("strips @mentions to plain names", () => {
    const html =
      "<h1><strong>CSC Board Meeting</strong></h1><p><strong>Thursday, September 24, 2026</strong></p>" +
      "<p><strong>ACTION:</strong>&nbsp; @Stephen Thomas to post the recap.</p>";
    expect(parseMinutesHtml(html).blocks).toEqual([
      { type: "action", label: "ACTION", text: "Stephen Thomas to post the recap.", indent: 0 },
    ]);
  });
});
