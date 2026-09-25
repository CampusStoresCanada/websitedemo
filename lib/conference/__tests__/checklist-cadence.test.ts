import { describe, expect, it } from "vitest";
import { deriveCheckpointOffsets, STANDARD_CADENCE_DAYS } from "../checklist-cadence";

/**
 * Reminder timing is DERIVED from the dates the tasks already carry, because
 * hand-authored checkpoints failed twice on CSC 2027 (measured 2026-09-24):
 *
 *   Meeting preferences  0 checkpoints  active, has tasks, sent nothing ever
 *   Your Conference      0 checkpoints  active, has tasks, sent nothing ever
 *
 * Neither threw. Both rendered correctly on the org page and showed as active
 * in the admin. Forgetting to type three rows was indistinguishable from a
 * working checklist — so nobody types them any more.
 */
describe("deriving when a checklist reminds people", () => {
  const CLOSES = new Date("2027-01-11");

  it("uses the standard cadence, then moves each reminder to a working day", () => {
    // Anchored on a task hardening 4 Jan, the raw offsets are 52/28/14. The
    // last lands on 2026-12-28 — the observed Boxing Day, because the 26th is
    // a Saturday — so it shifts back to Thursday the 24th and becomes 18.
    expect(deriveCheckpointOffsets(CLOSES, new Date("2027-01-04"))).toEqual([52, 28, 18]);
  });

  it("falls back to the checklist's own deadline when no task carries one", () => {
    expect(deriveCheckpointOffsets(CLOSES, null)).toEqual([...STANDARD_CADENCE_DAYS]);
  });

  it("widens so the first reminder still leads the EARLIEST task", () => {
    // The care package hardens 20 Nov on a checklist that closes 11 Jan.
    // Hand-authored 45/21/7 would first mention it on 27 Nov — a week late.
    const offsets = deriveCheckpointOffsets(CLOSES, new Date("2026-11-20"));
    const firstReminder = new Date(CLOSES);
    firstReminder.setUTCDate(firstReminder.getUTCDate() - offsets[0]);
    expect(firstReminder < new Date("2026-11-20")).toBe(true);
    // and it leads it by the full 45 days, not by whatever was left over
    expect(firstReminder.toISOString().slice(0, 10)).toBe("2026-10-06");
  });

  it("never narrows below the standard cadence for a late-hardening task", () => {
    // A task due AFTER the checklist closes must not pull the schedule in.
    expect(deriveCheckpointOffsets(CLOSES, new Date("2027-02-01"))).toEqual([...STANDARD_CADENCE_DAYS]);
  });

  it("returns widest-first, which is the order the sender expects", () => {
    const offsets = deriveCheckpointOffsets(CLOSES, new Date("2026-11-20"));
    expect(offsets).toEqual([...offsets].sort((a, b) => b - a));
  });
});

/**
 * Adopted from elections, not reinvented.
 *
 * Board votes already shift off weekends and national holidays via
 * lib/board/vote-schedule.ts, and elections already carry an env off-switch
 * because "did not email 40 campus stores" is not a property to leave to
 * configuration. Checklist reminders reach a wider list than either.
 */
describe("reminders land on a working day", () => {
  function landsOn(closes: string, earliestTask: string | null): string[] {
    const deadline = new Date(closes);
    return deriveCheckpointOffsets(deadline, earliestTask ? new Date(earliestTask) : null).map((d) => {
      const day = new Date(deadline);
      day.setUTCDate(day.getUTCDate() - d);
      return day.toISOString().slice(0, 10);
    });
  }

  it("never schedules a reminder on a Saturday or Sunday", () => {
    for (const closes of ["2027-01-11", "2027-02-04", "2026-11-02", "2027-03-15"]) {
      for (const day of landsOn(closes, null)) {
        const dow = new Date(day).getUTCDay();
        expect(dow, `${day} from ${closes}`).not.toBe(0);
        expect(dow, `${day} from ${closes}`).not.toBe(6);
      }
    }
  });

  it("moves off Christmas and Boxing Day rather than into them", () => {
    // A conference cadence runs straight through late December.
    const days = landsOn("2027-01-16", null); // 45 back = 2026-12-02, 21 = 12-26
    expect(days).not.toContain("2026-12-25");
    expect(days).not.toContain("2026-12-26");
  });

  it("shifts EARLIER, so a reminder never arrives after the weekend it warned about", () => {
    const [widest] = landsOn("2027-01-11", null);
    const naive = new Date("2027-01-11");
    naive.setUTCDate(naive.getUTCDate() - 45);
    expect(new Date(widest) <= naive).toBe(true);
  });
});

describe("the off-switch", () => {
  it("is off unless the env says exactly 1", async () => {
    const { checklistEmailSuppressed } = await import("../checklist-cadence");
    const original = process.env.CHECKLIST_SUPPRESS_EMAIL;
    try {
      delete process.env.CHECKLIST_SUPPRESS_EMAIL;
      expect(checklistEmailSuppressed()).toBe(false);
      process.env.CHECKLIST_SUPPRESS_EMAIL = "true";
      expect(checklistEmailSuppressed()).toBe(false); // only "1", like elections
      process.env.CHECKLIST_SUPPRESS_EMAIL = "1";
      expect(checklistEmailSuppressed()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.CHECKLIST_SUPPRESS_EMAIL;
      else process.env.CHECKLIST_SUPPRESS_EMAIL = original;
    }
  });
});
