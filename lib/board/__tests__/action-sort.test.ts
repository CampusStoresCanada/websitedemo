import { describe, it, expect } from "vitest";
import {
  ageBoost,
  runwayUsed,
  tierOf,
  sortActionItems,
  isEscalated,
  dueDateLabel,
  DEFAULT_SORT_POLICY,
  type SortableItem,
} from "@/lib/board/action-sort";

const TODAY = "2026-08-19";

function item(over: Partial<SortableItem> = {}): SortableItem {
  return {
    id: "i1",
    status: "open",
    priority: null,
    dueDate: null,
    startedAt: null,
    heldAt: null,
    raisedOn: "2026-08-19",
    assigneeCount: 1,
    titleLength: 40,
    qualityFlagCount: 0,
    ...over,
  };
}

describe("ageBoost", () => {
  it("is neutral on day one and saturates at the ceiling", () => {
    expect(ageBoost(0)).toBe(1);
    expect(ageBoost(30)).toBeCloseTo(1.197, 2);
    expect(ageBoost(60)).toBeCloseTo(1.316, 2);
    expect(ageBoost(114)).toBeCloseTo(1.425, 2);
    expect(ageBoost(100_000)).toBeCloseTo(1.5, 3);
  });

  it("never exceeds the ceiling, however old", () => {
    for (const days of [1, 50, 365, 5000]) {
      expect(ageBoost(days)).toBeLessThanOrEqual(1 + DEFAULT_SORT_POLICY.ageCeiling);
    }
  });

  it("earns most of its boost early, when a nudge can still work", () => {
    const firstMonth = ageBoost(30) - ageBoost(0);
    const monthsThreeToTwelve = ageBoost(365) - ageBoost(90);
    expect(firstMonth).toBeGreaterThan(monthsThreeToTwelve);
  });
});

describe("tiers", () => {
  it("puts a soon-due item in running_out and a distant one in live_work", () => {
    expect(tierOf(item({ dueDate: "2026-08-22" }), TODAY, DEFAULT_SORT_POLICY)).toBe("running_out");
    expect(tierOf(item({ dueDate: "2026-10-01" }), TODAY, DEFAULT_SORT_POLICY)).toBe("live_work");
  });

  it("treats an undated item as stalled", () => {
    expect(tierOf(item(), TODAY, DEFAULT_SORT_POLICY)).toBe("stalled");
  });

  it("treats deferred as held and an intention as unclaimed", () => {
    expect(tierOf(item({ status: "deferred" }), TODAY, DEFAULT_SORT_POLICY)).toBe("held");
    expect(tierOf(item({ status: "intention", assigneeCount: 0 }), TODAY, DEFAULT_SORT_POLICY)).toBe("unclaimed");
  });

  it("treats an owner-less item as unclaimed even if its status says otherwise", () => {
    expect(tierOf(item({ assigneeCount: 0 }), TODAY, DEFAULT_SORT_POLICY)).toBe("unclaimed");
  });
});

describe("the zombie must never outrank live work", () => {
  it("keeps a 114-day undated item below something due Friday", () => {
    const zombie = item({ id: "zombie", raisedOn: "2026-04-27", priority: "high" });
    const dueFriday = item({ id: "friday", dueDate: "2026-08-21", priority: "low" });

    const [first, second] = sortActionItems([zombie, dueFriday], TODAY);
    expect(first.item.id).toBe("friday");
    expect(second.item.id).toBe("zombie");
  });

  it("holds even when the zombie is absurdly old", () => {
    const ancient = item({ id: "ancient", raisedOn: "2019-01-01", priority: "high" });
    const dueSoon = item({ id: "soon", dueDate: "2026-08-24", priority: "low" });
    expect(sortActionItems([ancient, dueSoon], TODAY)[0].item.id).toBe("soon");
  });
});

describe("ordering within a tier", () => {
  it("sorts running_out by soonest deadline, not priority", () => {
    const later = item({ id: "later", dueDate: "2026-08-25", priority: "high" });
    const sooner = item({ id: "sooner", dueDate: "2026-08-20", priority: "low" });
    expect(sortActionItems([later, sooner], TODAY)[0].item.id).toBe("sooner");
  });

  it("uses age to break ties among stalled items", () => {
    const older = item({ id: "older", raisedOn: "2026-04-27" });
    const newer = item({ id: "newer", raisedOn: "2026-08-01" });
    expect(sortActionItems([newer, older], TODAY)[0].item.id).toBe("older");
  });

  it("ranks priority above age among stalled items", () => {
    const oldLow = item({ id: "oldLow", raisedOn: "2026-01-01", priority: "low" });
    const newHigh = item({ id: "newHigh", raisedOn: "2026-08-15", priority: "high" });
    expect(sortActionItems([oldLow, newHigh], TODAY)[0].item.id).toBe("newHigh");
  });

  it("offers the shortest, cleanest unclaimed item first", () => {
    const gnarly = item({ id: "gnarly", status: "intention", assigneeCount: 0, titleLength: 120, qualityFlagCount: 3 });
    const easy = item({ id: "easy", status: "intention", assigneeCount: 0, titleLength: 30, qualityFlagCount: 1 });
    expect(sortActionItems([gnarly, easy], TODAY)[0].item.id).toBe("easy");
  });
});

describe("runway and holding", () => {
  it("fills as time runs out", () => {
    const half = item({ startedAt: "2026-08-09", dueDate: "2026-08-29" });
    expect(runwayUsed(half, TODAY)).toBeCloseTo(0.5, 2);
  });

  it("is empty for an undated item", () => {
    expect(runwayUsed(item(), TODAY)).toBe(0);
  });

  it("is full once the due date has passed", () => {
    expect(runwayUsed(item({ startedAt: "2026-08-01", dueDate: "2026-08-10" }), TODAY)).toBe(1);
  });

  it("freezes at the fill it had when held", () => {
    const held = item({ startedAt: "2026-08-09", dueDate: "2026-08-29", heldAt: "2026-08-14T00:00:00Z" });
    expect(runwayUsed(held, TODAY)).toBeCloseTo(0.25, 2);
  });

  it("does not age held work", () => {
    // Two held items, wildly different ages, must not be separated by age —
    // otherwise On Hold punishes the honesty of declaring a hold.
    const oldHeld = item({ id: "old", status: "deferred", raisedOn: "2026-01-01" });
    const newHeld = item({ id: "new", status: "deferred", raisedOn: "2026-08-18" });
    const [a, b] = sortActionItems([oldHeld, newHeld], TODAY);
    expect(a.score).toBe(b.score);
  });
});

describe("escalation is a flag, not a boost", () => {
  // The real calendar, past AND future — future sittings must not count.
  const meetings = ["2026-05-28", "2026-06-23", "2026-07-30", "2026-08-27",
                    "2026-09-24", "2026-10-29", "2026-11-26", "2026-12-17"];

  it("fires once an item has survived enough meetings", () => {
    expect(isEscalated(item({ raisedOn: "2026-04-27" }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(true);
  });

  it("never fires on a brand-new item, however many meetings are scheduled ahead", () => {
    // The regression: meetingDates carries future sittings, so counting every
    // meeting after the raise date made a day-old item look three meetings old.
    expect(isEscalated(item({ raisedOn: TODAY }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
  });

  it("respects the 90-day floor even after three meetings", () => {
    // Meetings can sit close together; nothing raised weeks ago should be
    // asked whether it is still real.
    const dense = ["2026-06-05", "2026-06-19", "2026-07-03"];
    expect(isEscalated(item({ raisedOn: "2026-06-01" }), dense, DEFAULT_SORT_POLICY, "2026-07-10")).toBe(false);
  });

  it("does not fire on a recent item", () => {
    expect(isEscalated(item({ raisedOn: "2026-07-30" }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
  });

  it("does not fire on dropped work", () => {
    expect(isEscalated(item({ raisedOn: "2026-04-27", status: "dropped" }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
  });

  it("stops nagging once someone confirms it is still real", () => {
    const acked = item({ raisedOn: "2026-04-27", escalationAckedOn: "2026-07-30" });
    expect(isEscalated(acked, meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
  });

  it("resumes nagging after enough further meetings pass", () => {
    const longAgo = item({ raisedOn: "2026-04-27", escalationAckedOn: "2026-05-01" });
    expect(isEscalated(longAgo, meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(true);
  });

  it("does not fire on held or completed work", () => {
    expect(isEscalated(item({ raisedOn: "2026-04-27", status: "deferred" }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
    expect(isEscalated(item({ raisedOn: "2026-04-27", status: "complete" }), meetings, DEFAULT_SORT_POLICY, TODAY)).toBe(false);
  });

  it("still does not let an escalated item climb past live work", () => {
    const escalated = item({ id: "old", raisedOn: "2026-04-27", priority: "high" });
    const live = item({ id: "live", dueDate: "2026-09-30", priority: "low" });
    const [first] = sortActionItems([escalated, live], TODAY, meetings);
    expect(first.item.id).toBe("live");
  });
});

describe("dueDateLabel", () => {
  it("never returns blank", () => {
    expect(dueDateLabel(item({ dueDate: "2026-09-01" }), false)).toBe("2026-09-01");
    expect(dueDateLabel(item(), false)).toBe("Open");
    expect(dueDateLabel(item(), true)).toBe("Ongoing");
  });
});
