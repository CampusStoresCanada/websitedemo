import { describe, expect, it } from "vitest";
import { describeUrgency } from "../deadline-urgency";

// Seating is introduced today and hardens 11 January — 133 days apart.
const TODAY = "2026-08-31";

describe("gently, then accelerating", () => {
  it("introduces something a season away rather than demanding it", () => {
    // The bug this replaces: "Do this now." on a task 133 days out. Noise in
    // August is what teaches people to skip the message that matters in January.
    const u = describeUrgency("2027-01-11", TODAY);
    expect(u.tone).toBe("introducing");
    expect(u.daysUntil).toBe(133);
    expect(u.lead).toBe("Something to know about.");
  });

  it("accelerates as the date closes in", () => {
    // 133 / 62 / 20 / 3 / 0 days out. 1 December would still be "introducing"
    // at 92 days — the boundary is real and worth not fudging.
    const tones = ["2027-01-11", "2026-11-01", "2026-09-20", "2026-09-03", "2026-08-31"]
      .map((d) => describeUrgency(d, TODAY).tone);
    expect(tones).toEqual(["introducing", "planning", "due_soon", "imminent", "imminent"]);
  });

  it("counts down in the last week, where saying 'urgent' still means something", () => {
    expect(describeUrgency("2026-09-01", TODAY).lead).toBe("Tomorrow.");
    expect(describeUrgency("2026-09-04", TODAY).lead).toBe("4 days left.");
    expect(describeUrgency("2026-08-31", TODAY).lead).toBe("Today is the day.");
  });

  it("says the date has gone rather than pretending it has not", () => {
    const u = describeUrgency("2026-08-30", TODAY);
    expect(u.tone).toBe("passed");
    expect(u.daysUntil).toBe(-1);
  });

  it("counts calendar days without timezone arithmetic", () => {
    // A deadline is a day. Crossing a month or a year boundary must not shift
    // it, and no instant is ever constructed from these.
    expect(describeUrgency("2027-01-01", "2026-12-31").daysUntil).toBe(1);
    expect(describeUrgency("2026-09-01", "2026-08-31").daysUntil).toBe(1);
  });
});
