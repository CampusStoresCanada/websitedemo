import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG, type ElectionsConfig } from "../config";
import { deriveSchedule } from "../schedule";
import {
  planReminders,
  reminderDueOn,
  remindersPast,
  describeNonWorkingDay,
} from "../reminders";

const schedule = deriveSchedule("2027-01-21", CSC_ELECTIONS_CONFIG);

function withSteps(
  steps: ElectionsConfig["reminders"]["steps"],
  over: Partial<ElectionsConfig["reminders"]> = {}
): ElectionsConfig {
  return {
    ...CSC_ELECTIONS_CONFIG,
    reminders: { ...CSC_ELECTIONS_CONFIG.reminders, steps, ...over },
  };
}

describe("planReminders — the shipped defaults", () => {
  const plan = planReminders(schedule, CSC_ELECTIONS_CONFIG);

  it("puts every default step inside the voting window", () => {
    expect(plan.problems).toEqual([]);
    for (const step of plan.steps) {
      expect(step.problem).toBeNull();
      expect(step.sendOn >= plan.ballotsOpenAt).toBe(true);
      expect(step.sendOn <= plan.ballotsCloseAt).toBe(true);
    }
  });

  it("orders steps by the date they land, not the order they were typed", () => {
    const dates = plan.steps.map((s) => s.sendOn);
    expect([...dates].sort()).toEqual(dates);
  });

  it("describes each step in words a person can check", () => {
    // `describes` is the sentence; the date is a separate field so the panel can
    // render it as "Friday, 4 December" rather than an ISO string mid-sentence.
    const last = plan.steps[plan.steps.length - 1];
    expect(last.describes).toMatch(/before voting closes|the day voting closes/);
    expect(last.describes).toMatch(/no ballot on file|every eligible institution/);
  });
});

describe("planReminders — refusing a schedule that cannot work", () => {
  it("catches a step that lands before voting opens", () => {
    // The CSC window is 19 days; 30 days before close is well before it opens.
    const plan = planReminders(
      schedule,
      withSteps([{ daysBeforeClose: 30, label: "Way too early", audience: "not_yet_voted" }])
    );
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toMatch(/before voting opens/);
    expect(plan.steps[0].problem).toMatch(/window is only 19 days/);
  });

  it("catches two steps landing on the same day", () => {
    const plan = planReminders(
      schedule,
      withSteps([
        { daysBeforeClose: 3, label: "A", audience: "not_yet_voted" },
        { daysBeforeClose: 3, label: "B", audience: "not_yet_voted" },
      ])
    );
    expect(plan.problems.some((p) => /both land on/.test(p))).toBe(true);
  });

  it("catches steps closer together than the minimum gap", () => {
    const plan = planReminders(
      schedule,
      withSteps(
        [
          { daysBeforeClose: 4, label: "A", audience: "not_yet_voted" },
          { daysBeforeClose: 3, label: "B", audience: "not_yet_voted" },
        ],
        { minimumGapDays: 3 }
      )
    );
    expect(plan.problems.some((p) => /closer than the 3-day minimum/.test(p))).toBe(true);
  });
});

describe("reminderDueOn", () => {
  const plan = planReminders(schedule, CSC_ELECTIONS_CONFIG);

  it("finds the step landing exactly today", () => {
    const target = plan.steps[1];
    expect(reminderDueOn(plan, target.sendOn)?.label).toBe(target.label);
  });

  it("fires nothing on a day with no step", () => {
    expect(reminderDueOn(plan, "2026-11-11")).toBeNull();
  });

  it("does NOT catch up a missed day", () => {
    // "Closing tomorrow" sent the day after it was due misstates the deadline.
    // A skipped step stays skipped and shows as unsent.
    const target = plan.steps[0];
    const [y, m, d] = target.sendOn.split("-").map(Number);
    const dayAfter = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    expect(reminderDueOn(plan, dayAfter)?.label).not.toBe(target.label);
  });

  it("fires nothing at all when reminders are switched off", () => {
    const off = planReminders(schedule, {
      ...CSC_ELECTIONS_CONFIG,
      reminders: { ...CSC_ELECTIONS_CONFIG.reminders, enabled: false },
    });
    expect(reminderDueOn(off, off.steps[0].sendOn)).toBeNull();
  });

  it("refuses to fire any step while the plan has problems", () => {
    // A broken schedule is not partially run. If the admin has configured
    // something incoherent, nothing goes out until they fix it.
    const broken = planReminders(
      schedule,
      withSteps([
        { daysBeforeClose: 3, label: "A", audience: "not_yet_voted" },
        { daysBeforeClose: 3, label: "B", audience: "not_yet_voted" },
      ])
    );
    expect(reminderDueOn(broken, broken.steps[0].sendOn)).toBeNull();
  });
});

describe("remindersPast", () => {
  it("reports the steps already behind us", () => {
    const plan = planReminders(schedule, CSC_ELECTIONS_CONFIG);
    const past = remindersPast(plan, plan.ballotsCloseAt);
    expect(past.length).toBe(plan.steps.length);
    expect(remindersPast(plan, plan.ballotsOpenAt)).toEqual([]);
  });
});

describe("working days — the Sunday problem", () => {
  // The 2027 cycle closes Monday 2026-12-07, so "1 day before" is Sunday the 6th.
  it("moves a weekend send earlier by default, and says so", () => {
    const plan = planReminders(
      schedule,
      withSteps([{ daysBeforeClose: 1, label: "Closing tomorrow", audience: "not_yet_voted" }])
    );
    const step = plan.steps[0];
    expect(step.movedFrom).toBe("2026-12-06");
    expect(step.movedBecause).toBe("a Sunday");
    expect(step.sendOn).toBe("2026-12-04");
    expect(plan.notes.some((n) => /would have landed on 2026-12-06, a Sunday/.test(n))).toBe(true);
  });

  it("moves later when asked to", () => {
    const plan = planReminders(
      schedule,
      withSteps([
        {
          daysBeforeClose: 1,
          label: "Closing tomorrow",
          audience: "not_yet_voted",
          onNonWorkingDay: "move_later",
        },
      ])
    );
    expect(plan.steps[0].sendOn).toBe("2026-12-07");
  });

  it("sends on the weekend when that is deliberate, and stops nagging about it", () => {
    // "If they want to schedule the reminder on a Sunday, congrats." Allowed —
    // but it is stated once so nobody discovers it by accident.
    const plan = planReminders(
      schedule,
      withSteps([
        {
          daysBeforeClose: 1,
          label: "Sunday on purpose",
          audience: "not_yet_voted",
          onNonWorkingDay: "send_anyway",
        },
      ])
    );
    const step = plan.steps[0];
    expect(step.sendOn).toBe("2026-12-06");
    expect(step.movedFrom).toBeNull();
    expect(step.deliberateNonWorkingDay).toBe(true);
    expect(plan.problems).toEqual([]);
    expect(plan.notes.some((n) => /campus stores are closed/.test(n))).toBe(true);
  });

  it("catches a collision CREATED by the weekend shift", () => {
    // Sunday the 6th moves back to Friday the 4th — which is where "Final week"
    // already sits. Neither step is wrong on its own; only the adjusted dates
    // reveal it, which is why the gap check runs after the shift.
    const plan = planReminders(
      schedule,
      withSteps([
        { daysBeforeClose: 3, label: "Final week", audience: "not_yet_voted" },
        { daysBeforeClose: 1, label: "Closing tomorrow", audience: "not_yet_voted" },
      ])
    );
    expect(plan.steps[0].sendOn).toBe(plan.steps[1].sendOn);
    expect(plan.problems.some((p) => /both land on 2026-12-04/.test(p))).toBe(true);
  });

  it("names a statutory holiday rather than calling it a weekend", () => {
    expect(describeNonWorkingDay("2026-12-25")).toBe("a statutory holiday");
    expect(describeNonWorkingDay("2026-12-26")).toBe("a Saturday");
    expect(describeNonWorkingDay("2026-12-04")).toBeNull();
  });
});
