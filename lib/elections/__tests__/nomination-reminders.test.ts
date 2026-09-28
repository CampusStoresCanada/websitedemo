/**
 * The nudge during the nomination window.
 *
 * The reminder machinery only ever pointed at the ballot: every step counted
 * back from ballots close and both audiences were voting audiences. The call
 * for nominations refuses to send twice, and the chase only walks nominations
 * that already exist — so an eligible institution that had done nothing was
 * unreachable for the whole window.
 *
 * The dates below are the live 2027 cycle, because the reason this series is
 * 21/10 rather than the obvious 21/14 is a real calendar: fourteen days before
 * the 2026-10-23 close is the Friday before Thanksgiving.
 */
import { describe, it, expect } from "vitest";
import { planReminders } from "../reminders";
import { deriveSchedule } from "../schedule";
import { CSC_ELECTIONS_CONFIG } from "../config";

const SCHEDULE = deriveSchedule("2027-01-21", CSC_ELECTIONS_CONFIG);
const nominations = planReminders(SCHEDULE, CSC_ELECTIONS_CONFIG, "nominations");
const ballot = planReminders(SCHEDULE, CSC_ELECTIONS_CONFIG, "ballot");

describe("the phases are planned apart", () => {
  it("counts the nomination steps back from the nomination close", () => {
    expect(nominations.windowClosesAt).toBe("2026-10-23");
    expect(nominations.phase).toBe("nominations");
  });

  it("leaves the ballot series exactly as it was", () => {
    expect(ballot.windowClosesAt).toBe("2026-12-07");
    expect(ballot.steps.map((s) => s.daysBeforeClose)).toEqual([12, 5, 1]);
  });

  it("puts no step in both", () => {
    const overlap = nominations.steps
      .map((s) => s.label)
      .filter((l) => ballot.steps.some((b) => b.label === l));
    expect(overlap).toEqual([]);
  });
});

describe("the nomination series", () => {
  it("runs two steps, not three", () => {
    expect(nominations.steps).toHaveLength(2);
  });

  it("stops ten days out, because two other institutions still have to act", () => {
    const last = nominations.steps[nominations.steps.length - 1];
    expect(last.daysBeforeClose).toBe(10);
  });

  it("avoids the Friday before Thanksgiving", () => {
    // 14 days before close is 2026-10-09, a working day immediately ahead of
    // the 2026-10-12 holiday, so the weekend rule would NOT have moved it.
    const dates = nominations.steps.map((s) => s.sendOn);
    expect(dates).not.toContain("2026-10-09");
    expect(dates).toContain("2026-10-13");
  });

  it("plans without problems", () => {
    expect(nominations.problems).toEqual([]);
  });

  it("targets institutions that have put nobody forward", () => {
    expect(nominations.steps.some((s) => s.audience === "has_not_nominated")).toBe(true);
    expect(nominations.steps.map((s) => s.describes).join(" ")).toContain(
      "before nominations close"
    );
  });
});

describe("steps written before phases existed", () => {
  it("are still treated as ballot steps", () => {
    const legacy = {
      ...CSC_ELECTIONS_CONFIG,
      reminders: {
        ...CSC_ELECTIONS_CONFIG.reminders,
        steps: [{ daysBeforeClose: 3, label: "Legacy", audience: "not_yet_voted" as const }],
      },
    };
    expect(planReminders(SCHEDULE, legacy, "ballot").steps).toHaveLength(1);
    expect(planReminders(SCHEDULE, legacy, "nominations").steps).toHaveLength(0);
  });
});
