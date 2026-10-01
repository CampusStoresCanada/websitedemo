import { describe, it, expect } from "vitest";
import { buildBenchmarkingTimeline, type BenchmarkingTimelineFacts } from "../timeline";
import { formatDeadline } from "../deadline";

/*
  The spine and the member must name the same day.

  ⛔ The regression: this timeline built its dates with `closesAt.slice(0, 10)`.
  `closes_at` is an EXCLUSIVE boundary stored as midnight Pacific, so the slice
  named the first day the survey is SHUT — and it rendered as the date chip on
  the "Close the survey" step, directly beside a page header reading November
  20. Two dates for one deadline, on one screen, and the later one sat next to
  the button.

  Nothing caught it: the slice is a valid date string, every type checks, and
  no test touched this file.
*/

const FY2026: BenchmarkingTimelineFacts = {
  fiscalYear: 2026,
  status: "draft",
  // Midnight Pacific on the 21st — so the 20th is a full working day coast to
  // coast, which is the whole reason the boundary is stored this way.
  opensAt: "2026-10-08T07:00:00Z",
  closesAt: "2026-11-21T08:00:00Z",
  recipientsTotal: 52,
  recipientsConfirmed: 52,
  betaTestersAppointed: 7,
  invited: 0,
  drafts: 0,
  submitted: 0,
  openFlags: 0,
  reviewDone: 0,
  reviewTotal: 0,
};

const stage = (facts: BenchmarkingTimelineFacts, key: string, today = "2026-10-01") =>
  buildBenchmarkingTimeline(facts, today).find((s) => s.key === key)!;

describe("the cycle spine's dates", () => {
  it("dates the close by the last day a store can file, not the boundary", () => {
    const closed = stage(FY2026, "closed");
    expect(closed.on).toBe("2026-11-20");
    expect(closed.detail).toContain(formatDeadline(FY2026.closesAt));
    // The day the doors shut must never appear as the deadline.
    expect(closed.on).not.toBe("2026-11-21");
    expect(closed.detail).not.toContain("November 21");
  });

  it("does not call the cycle overdue on its own last day", () => {
    expect(stage(FY2026, "closed", "2026-11-20").state).toBe("upcoming");
    expect(stage(FY2026, "closed", "2026-11-21").state).toBe("overdue");
  });

  it("reads the opening in the zone it was set for", () => {
    /*
      Stored as midnight UTC, this is still October 7th in Vancouver — the
      store with the least time, and the one a slice would tell the wrong day.
    */
    const westOfMidnight = { ...FY2026, opensAt: "2026-10-08T00:00:00Z" };
    expect(stage(westOfMidnight, "open").on).toBe("2026-10-07");
  });

  it("says so plainly when a cycle has no dates yet", () => {
    const undated = { ...FY2026, opensAt: null, closesAt: null };
    expect(stage(undated, "closed").on).toBeNull();
    expect(stage(undated, "closed").detail).toBe("No closing date set.");
    expect(stage(undated, "closed").state).toBe("upcoming");
  });
});
