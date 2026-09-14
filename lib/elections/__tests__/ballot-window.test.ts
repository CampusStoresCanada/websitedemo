/**
 * Voting opens when the field is fixed, not on a derived date.
 *
 * The dangerous direction is the seal: it used to refuse only while the PHASE
 * was "balloting", which stopped meaning "voting is open" the moment a ballot
 * could be circulated ahead of the planned date. A ballot opened early sat in
 * phase "between_nominations_and_ballot", so the old guard would have waved the
 * seal through and destroyed every vote already cast.
 */
import { describe, it, expect } from "vitest";
import { canOpenBallots, deriveSchedule } from "../schedule";
import { CSC_ELECTIONS_CONFIG } from "../config";

// The live 2027 cycle: AGM 2027-01-21, nominations close 2026-10-23,
// ballots planned 2026-11-18 to 2026-12-07.
const SCHEDULE = deriveSchedule("2027-01-21", CSC_ELECTIONS_CONFIG);

describe("the planned open date is a plan, not a gate", () => {
  it("opens the day after nominations close, 25 days before the plan", () => {
    const w = canOpenBallots(SCHEDULE, "2026-10-24");
    expect(w.open).toBe(true);
    if (w.open) {
      expect(w.early).toBe(true);
      expect(w.daysEarly).toBeGreaterThan(20);
      expect(w.pastByLawDeadline).toBe(false);
    }
  });

  it("is open on the planned date, and not flagged early", () => {
    const w = canOpenBallots(SCHEDULE, SCHEDULE.ballotsOpenAt);
    expect(w.open).toBe(true);
    if (w.open) expect(w.early).toBe(false);
  });

  it("reports circulating past the by-law deadline rather than refusing it", () => {
    // Part V S3(a) requires circulation by 2026-11-22. Late is a defect;
    // refusing would turn it into no election at all.
    const w = canOpenBallots(SCHEDULE, "2026-11-30");
    expect(w.open).toBe(true);
    if (w.open) expect(w.pastByLawDeadline).toBe(true);
  });
});

describe("the close date is still hard", () => {
  it("is open the day before voting closes", () => {
    expect(canOpenBallots(SCHEDULE, "2026-12-06").open).toBe(true);
  });

  it("is closed on the close date itself", () => {
    expect(canOpenBallots(SCHEDULE, SCHEDULE.ballotsCloseAt).open).toBe(false);
  });

  it("is closed after it, and says so rather than quoting the open date", () => {
    const w = canOpenBallots(SCHEDULE, "2026-12-20");
    expect(w.open).toBe(false);
    if (!w.open) {
      expect(w.reason).toContain(SCHEDULE.ballotsCloseAt);
      expect(w.reason).not.toContain(SCHEDULE.ballotsOpenAt);
    }
  });

  it("opening early never shortens the window — close is untouched", () => {
    expect(SCHEDULE.ballotsCloseAt).toBe("2026-12-07");
    expect(canOpenBallots(SCHEDULE, "2026-10-24").open).toBe(true);
    expect(canOpenBallots(SCHEDULE, "2026-12-06").open).toBe(true);
  });
});

describe("what the seal guard now asks", () => {
  it("still reports voting OPEN on a day the old phase check called quiet", () => {
    // 2026-11-01 is between nominations closing and the planned open date.
    // Old guard: phase !== "balloting" -> seal permitted. New: refused.
    const w = canOpenBallots(SCHEDULE, "2026-11-01");
    expect(w.open).toBe(true);
  });

  it("permits the seal only once voting has actually closed", () => {
    expect(canOpenBallots(SCHEDULE, "2026-12-07").open).toBe(false);
  });
});
