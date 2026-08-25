import { describe, it, expect } from "vitest";
import { buildAgmAgenda, type AgmAgendaInput } from "../documents/agm-agenda";
import { buildAgmScript } from "../documents/agm-script";

/**
 * The agenda is derived from the script's blocks. These tests exist mostly to
 * hold that derivation in place: if somebody adds an item to the script, it
 * should appear on the members' agenda without anyone maintaining a second list.
 */

function input(over: Partial<AgmAgendaInput> = {}): AgmAgendaInput {
  return {
    cycleYear: 2027,
    agmDate: "2027-01-21",
    blocks: [
      { number: null, heading: "Introductions and pre-meeting housekeeping", speaker: "Chair" },
      { number: 1, heading: "Call to Order", speaker: "Chair" },
      { number: 2, heading: "Receipt of Minutes", speaker: "Chair" },
      { number: null, heading: "Board of Directors Installation and Oath of Office", speaker: "ED" },
      { number: 3, heading: "Adjournment", speaker: "Chair" },
    ],
    times: [
      { label: "Pacific Time", start: "9:00 am", end: "10:00 am" },
      { label: "Newfoundland Time", start: "1:30 pm", end: "2:30 pm" },
    ],
    meetingUrl: "https://example.zoom.us/j/123",
    ...over,
  };
}

describe("buildAgmAgenda — what belongs on it", () => {
  it("drops pre-meeting housekeeping, which is not business of the meeting", () => {
    const a = buildAgmAgenda(input());
    expect(a.items.map((i) => i.heading)).not.toContain(
      "Introductions and pre-meeting housekeeping"
    );
  });

  it("keeps unnumbered business, like the installation of the board", () => {
    // It has no number in the script but it is real business and members should
    // see that it happens.
    const a = buildAgmAgenda(input());
    const installation = a.items.find((i) => i.heading.startsWith("Board of Directors"));
    expect(installation).toBeDefined();
    expect(installation?.number).toBeNull();
  });

  it("preserves the script's order", () => {
    const a = buildAgmAgenda(input());
    expect(a.items.map((i) => i.heading)).toEqual([
      "Call to Order",
      "Receipt of Minutes",
      "Board of Directors Installation and Oath of Office",
      "Adjournment",
    ]);
  });

  it("names who leads each item", () => {
    const a = buildAgmAgenda(input());
    // [\s\S] rather than the `s` flag — the tsconfig target predates dotAll.
    expect(a.html).toMatch(/Call to Order[\s\S]*Chair/);
  });
});

describe("buildAgmAgenda — the practical detail", () => {
  it("lists start times across every zone", () => {
    // A national membership on one call. This line has caused more confusion
    // than anything else in the notice.
    const a = buildAgmAgenda(input());
    expect(a.html).toMatch(/Pacific Time — 9:00 am to 10:00 am/);
    expect(a.html).toMatch(/Newfoundland Time — 1:30 pm to 2:30 pm/);
  });

  it("includes the meeting link when there is one, and omits the section when not", () => {
    expect(buildAgmAgenda(input()).html).toContain("example.zoom.us");
    const none = buildAgmAgenda(input({ meetingUrl: null }));
    expect(none.html).not.toMatch(/<strong>Where<\/strong>/);
  });

  it("writes the date in full", () => {
    expect(buildAgmAgenda(input()).html).toContain("Thursday, January 21, 2027");
  });

  it("escapes anything it did not author", () => {
    const a = buildAgmAgenda(
      input({ blocks: [{ number: 1, heading: "A & B", speaker: "<script>x</script>" }] })
    );
    expect(a.html).toContain("A &amp; B");
    expect(a.html).not.toContain("<script>");
  });
});

describe("buildAgmAgenda — derived from the real script", () => {
  it("picks up every numbered item the script produces", () => {
    // The point of the derivation: add an item to the script and it appears
    // here, with no second list to maintain.
    const script = buildAgmScript({
      cycleYear: 2027,
      agmDate: "2027-01-21",
      times: [{ label: "Eastern Time", start: "12:00 pm", end: "1:00 pm" }],
      meetingUrl: null,
      chair: { name: "Shannon Blackadder", institution: "Mount Royal University" },
      treasurer: { name: "A Treasurer", institution: "Somewhere" },
      nominatingChair: { name: "A Past President", institution: "Elsewhere" },
      executiveDirector: "Greg",
      publicAccountant: "MNP LLP",
      fiscalYearEnd: "2026-08-31",
      priorAgmDate: "2026-01-15",
      elected: [],
      continuing: [],
      departing: [],
      outcome: "acclaimed",
    } as never);

    const agenda = buildAgmAgenda({
      cycleYear: 2027,
      agmDate: "2027-01-21",
      blocks: script.blocks,
      times: [],
      meetingUrl: null,
    });

    const scriptNumbered = script.blocks.filter((b) => b.number !== null).map((b) => b.heading);
    const agendaNumbered = agenda.items.filter((i) => i.number !== null).map((i) => i.heading);
    expect(agendaNumbered).toEqual(scriptNumbered);
    expect(agendaNumbered.length).toBeGreaterThan(4);
  });
});
