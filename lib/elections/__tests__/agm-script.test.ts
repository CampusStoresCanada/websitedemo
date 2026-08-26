import { describe, it, expect } from "vitest";
import { buildAgmScript, type AgmScriptInput } from "../documents/agm-script";

/** Shaped on the real 2026 script — same roles, same choreography. */
const INPUT: AgmScriptInput = {
  cycleYear: 2027,
  agmDate: "2027-01-21",
  times: [
    { label: "Pacific Time", start: "9:00 am", end: "10:00 am" },
    { label: "Mountain Time", start: "10:00 am", end: "11:00 am" },
    { label: "Eastern Time", start: "12:00 pm", end: "1:00 pm" },
    { label: "Newfoundland Time", start: "1:30 pm", end: "2:30 pm" },
  ],
  meetingUrl: "https://meet.google.com/example",
  priorAgmDate: "2026-01-15",
  chair: { name: "Shannon Blackadder", institution: "University of Calgary", role: "President" },
  treasurer: { name: "Sean Bell", institution: "University of Lethbridge" },
  nominatingChair: { name: "Imelda May", institution: "Capilano University" },
  executiveDirector: "Greg McPherson",
  pollster: "Stephen",
  publicAccountant: "MNP LLP",
  fiscalYearEnd: "2026-08-31",
  elected: [{ name: "Sam Willis", institution: "Lakeland College" }],
  continuing: [{ name: "Jason Kack", institution: "McGill University" }],
  departing: [{ name: "Kerry Martin", institution: "Wilfrid Laurier University" }],
  acclaimed: false,
  officerMeetingNote: null,
};

describe("what the script generates", () => {
  const s = buildAgmScript(INPUT);

  it("carries every timezone and the meeting link", () => {
    expect(s.markdown).toContain("Pacific Time — 9:00 am – 10:00 am");
    expect(s.markdown).toContain("Newfoundland Time — 1:30 pm – 2:30 pm");
    expect(s.markdown).toContain("https://meet.google.com/example");
  });

  it("generates the motion choreography every time it appears", () => {
    // Four near-identical motion blocks is most of the reason this exists.
    const soMoves = (s.markdown.match(/so moves/g) ?? []).length;
    expect(soMoves).toBe(4); // minutes, financials, accountant, adjournment
    expect(s.markdown).toContain("Stephen will now open the vote for this Motion");
  });

  it("names the prior AGM in the minutes motion", () => {
    expect(s.markdown).toContain("Thursday, January 15, 2026 Annual General Meeting");
  });

  it("reproduces the oath verbatim", () => {
    expect(s.markdown).toContain(
      "promise to faithfully perform to the best of your ability, all of the duties and obligations"
    );
    expect(s.markdown).toContain("place the interest of the association before your own");
  });

  it("lists elected and continuing directors with their institutions", () => {
    expect(s.markdown).toContain("Sam Willis, Lakeland College");
    expect(s.markdown).toContain("Jason Kack, McGill University");
  });
});

describe("what it refuses to write", () => {
  const s = buildAgmScript(INPUT);

  it("leaves the human sections as stage directions, in CSC's own convention", () => {
    expect(s.markdown).toContain("<<< INSERT PRESIDENT'S REPORT HERE >>>");
    expect(s.markdown).toContain("<<< INSERT FINANCIAL REPORT NARRATIVE");
    expect(s.markdown).toContain("<<< INSERT TRIBUTE");
    expect(s.markdown).toContain("<<< LAND ACKNOWLEDGEMENT");
  });

  it("lists what is outstanding at the top, so nobody hands it over half-written", () => {
    expect(s.outstanding).toHaveLength(4);
    expect(s.markdown).toContain("4 sections still to be written before the meeting");
    expect(s.outstanding.join(" ")).toContain("Kerry Martin");
  });

  it("drops the tribute entirely when nobody is departing", () => {
    const noDeparture = buildAgmScript({ ...INPUT, departing: [] });
    expect(noDeparture.markdown).not.toContain("<<< INSERT TRIBUTE");
    expect(noDeparture.outstanding).toHaveLength(3);
  });
});

describe("cases the meeting actually varies on", () => {
  it("says acclaimed, not elected, when there was no ballot", () => {
    const s = buildAgmScript({ ...INPUT, acclaimed: true });
    expect(s.markdown).toContain("No additional nominations were received");
    expect(s.markdown).toContain("acclaimed Board member");
    expect(s.markdown).not.toContain("An election was held");
  });

  it("skips the minutes item where there is no prior meeting on record", () => {
    const s = buildAgmScript({ ...INPUT, priorAgmDate: null });
    expect(s.blocks.some((b) => b.heading === "Receipt of Minutes")).toBe(false);
    expect((s.markdown.match(/so moves/g) ?? []).length).toBe(3);
  });

  it("copes with no pollster named", () => {
    const s = buildAgmScript({ ...INPUT, pollster: null });
    expect(s.markdown).toContain("The vote will now be opened for this Motion");
    expect(s.markdown).not.toContain("null will now open");
  });

  it("copes with no treasurer in post", () => {
    const s = buildAgmScript({ ...INPUT, treasurer: null });
    expect(s.markdown).toContain("Thank you the Treasurer".replace("the Treasurer", "the Treasurer"));
    expect(s.markdown).not.toContain("undefined");
  });
});
