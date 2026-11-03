/**
 * Which parts of the committee's screen still matter.
 *
 * The screen grew a section per feature until it was fourteen full-width
 * panels, nearly all about a moment that has passed or is months away. During
 * nominations it rendered the ballot reminder schedule and the AGM package in
 * full; after the close it kept the nominee chase, the co-signature chase and
 * a term-history editor per nominee, none of which can do anything once the
 * field is fixed.
 */
import { describe, it, expect } from "vitest";
import { cyclePhase, sectionState, phaseApplies } from "../phases";
import type { Election } from "../service";

const election = (over: Partial<Election> = {}) =>
  ({
    status: "nominating",
    outcome: null,
    schedule: {
      agmDate: "2027-01-21",
      nominationsOpenAt: "2026-09-23",
      nominationsCloseAt: "2026-10-23",
      ballotsOpenAt: "2026-11-18",
      ballotsCloseAt: "2026-12-07",
    },
    ...over,
  }) as Election;

describe("the phase follows STATUS, not the calendar", () => {
  it("stays in nominations after the closing date, until somebody closes", () => {
    // Exactly the state this cycle sat in for three days: past the published
    // close, nothing pressed. Reading dates alone would have moved the screen
    // on and hidden the controls that still needed using.
    expect(cyclePhase(election(), "2026-10-26")).toBe("nominating");
  });

  it("moves on when the close actually happens", () => {
    expect(
      cyclePhase(election({ status: "nominations_closed", outcome: "acclaimed" }), "2026-10-26")
    ).toBe("field_fixed");
  });

  it("reads a balloted cycle as balloting", () => {
    expect(cyclePhase(election({ status: "balloting", outcome: "balloted" }), "2026-11-20")).toBe(
      "balloting"
    );
  });

  it("separates having a result from the meeting having happened", () => {
    const certified = election({ status: "certified", outcome: "acclaimed" });
    expect(cyclePhase(certified, "2026-12-01")).toBe("result");
    expect(cyclePhase(certified, "2027-01-21")).toBe("after_meeting");
  });
});

describe("where a section sits", () => {
  it("expands the current phase and folds the rest", () => {
    expect(sectionState("nominating", "nominating")).toBe("current");
    expect(sectionState("nominating", "field_fixed")).toBe("past");
    expect(sectionState("field_fixed", "nominating")).toBe("future");
  });

  it("folds the nomination apparatus once the field is fixed", () => {
    for (const current of ["field_fixed", "balloting", "result", "after_meeting"] as const) {
      expect(sectionState("nominating", current)).toBe("past");
    }
  });

  it("folds the AGM sections while nominations are still open", () => {
    expect(sectionState("field_fixed", "nominating")).toBe("future");
  });
});

describe("a phase a cycle will never reach", () => {
  it("drops the ballot sections from an acclaimed cycle", () => {
    expect(phaseApplies("balloting", election({ outcome: "acclaimed" }))).toBe(false);
  });

  it("keeps them for a balloted one", () => {
    expect(phaseApplies("balloting", election({ outcome: "balloted" }))).toBe(true);
  });

  it("keeps them while the outcome is still unknown", () => {
    expect(phaseApplies("balloting", election())).toBe(true);
  });

  it("never drops a non-ballot section", () => {
    expect(phaseApplies("nominating", election({ outcome: "acclaimed" }))).toBe(true);
  });
});
