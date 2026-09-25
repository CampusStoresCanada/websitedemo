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

  it("uses the standard cadence when no task hardens earlier", () => {
    expect(deriveCheckpointOffsets(CLOSES, new Date("2027-01-04"))).toEqual([52, 28, 14]);
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
