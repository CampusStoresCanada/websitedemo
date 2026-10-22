import { describe, expect, it } from "vitest";
import { arrangeStaffChecklists, describeUrgency } from "../deadline-urgency";

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

describe("the War Room's Now / Next / Later / Done", () => {
  const TZ = "America/Toronto";
  const list = (name: string, deadline: string, states: string[]) => ({
    name,
    deadline,
    tasks: states.map((state) => ({ state })),
  });
  const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name);

  it("puts today's and late lists in Now, the next one in Next, the rest in Later", () => {
    const groups = arrangeStaffChecklists(
      [
        list("week before", "2027-01-26T04:59:59Z", ["pending"]),
        list("badges", "2027-01-12T04:59:59Z", ["pending"]),
        list("doors open", "2027-02-01T12:00:00Z", ["pending"]),
        list("late", "2027-01-05T04:59:59Z", ["pending"]),
      ],
      new Date("2027-01-11T15:00:00Z"),
      TZ
    );
    // 2027-01-12T04:59:59Z is 11:59 pm on the 11th in Toronto: today, not tomorrow.
    expect(names(groups.now)).toEqual(["late", "badges"]);
    expect(names(groups.next)).toEqual(["week before"]);
    expect(names(groups.later)).toEqual(["doors open"]);
  });

  it("folds answered lists into Done, latest first, counting doesn't-apply as answered", () => {
    const groups = arrangeStaffChecklists(
      [
        list("a", "2027-01-01T12:00:00Z", ["done", "not_applicable"]),
        list("b", "2027-01-02T12:00:00Z", ["done"]),
        list("c", "2027-03-01T12:00:00Z", ["done", "pending"]),
      ],
      new Date("2027-01-10T12:00:00Z"),
      TZ
    );
    expect(names(groups.done)).toEqual(["b", "a"]);
    expect(names(groups.next)).toEqual(["c"]);
    expect(groups.now).toEqual([]);
  });

  it("always shows the next open list, however far away", () => {
    const groups = arrangeStaffChecklists(
      [list("far", "2027-02-01T12:00:00Z", ["pending"])],
      new Date("2026-10-22T12:00:00Z"),
      TZ
    );
    expect(names(groups.next)).toEqual(["far"]);
  });
});
