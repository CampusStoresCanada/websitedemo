import { describe, it, expect } from "vitest";
import { holdsTheFloor } from "../one-open-ask";

const row = (o: Partial<{ sent_at: string | null; last_reminder_sent_at: string | null; reminder_count: number }> = {}) =>
  ({ sent_at: null, last_reminder_sent_at: null, reminder_count: 0, ...o });

// a fake clock: the string IS the number of days ago
const daysSince = (iso: string) => Number(iso);

const chases = { reminderEveryDays: 10, maxReminders: 2 };
const neverChases = { reminderEveryDays: null, maxReminders: 0 };

describe("one open ask at a time", () => {
  it("an unsent step holds nothing — it has not been asked yet", () => {
    expect(holdsTheFloor(row(), chases, daysSince)).toBe(false);
  });

  it("a sent step with reminders left holds the floor", () => {
    expect(holdsTheFloor(row({ sent_at: "1", reminder_count: 0 }), chases, daysSince)).toBe(true);
  });

  it("still holds it part-way through its reminders", () => {
    expect(holdsTheFloor(row({ sent_at: "30", reminder_count: 1 }), chases, daysSince)).toBe(true);
  });

  it("lets go once its reminders are exhausted", () => {
    expect(holdsTheFloor(row({ sent_at: "60", reminder_count: 2 }), chases, daysSince)).toBe(false);
  });

  it("a step that never chases still holds the floor for a fortnight", () => {
    expect(holdsTheFloor(row({ sent_at: "3" }), neverChases, daysSince)).toBe(true);
  });

  it("...and lets go after that, so the next task can come", () => {
    expect(holdsTheFloor(row({ sent_at: "15" }), neverChases, daysSince)).toBe(false);
  });

  it("measures from the last reminder, not the original send", () => {
    expect(holdsTheFloor(row({ sent_at: "40", last_reminder_sent_at: "2" }), neverChases, daysSince)).toBe(true);
  });

  it("holds nothing for a step with no schedule entry", () => {
    expect(holdsTheFloor(row({ sent_at: "1" }), undefined, daysSince)).toBe(false);
  });
});
