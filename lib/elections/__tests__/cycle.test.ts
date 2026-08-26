import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import { resolveAgmDate, deriveSchedule } from "../schedule";
import { electionSlug } from "../cycle";

describe("electionSlug", () => {
  it("is stable, so the kickoff guard can tell whether a cycle is already open", () => {
    expect(electionSlug("board_of_directors", 2027)).toBe("board-2027");
    expect(electionSlug("board_of_directors", 2028)).toBe("board-2028");
  });
});

/**
 * The rollover the kickoff guard depends on: which cycle is "next" on a given
 * day. Mirrors ensureElectionKickoff's logic without needing a database.
 */
function nextCycleYear(today: string): number {
  const thisYear = Number(today.slice(0, 4));
  const agm = resolveAgmDate(CSC_ELECTIONS_CONFIG, thisYear);
  return !agm || agm < today ? thisYear + 1 : thisYear;
}

describe("which cycle the kickoff guard targets", () => {
  it("looks to next January once this year's AGM has passed", () => {
    // Late August 2026 — the 2026 AGM was in January and is long gone.
    expect(nextCycleYear("2026-08-21")).toBe(2027);
  });

  it("still targets this January in the days before it", () => {
    expect(nextCycleYear("2027-01-05")).toBe(2027);
  });

  it("rolls the day AFTER the AGM, not the day of", () => {
    // 2027 AGM is Thursday 21 January.
    expect(nextCycleYear("2027-01-21")).toBe(2027);
    expect(nextCycleYear("2027-01-22")).toBe(2028);
  });

  it("keeps working years out with no code change", () => {
    expect(nextCycleYear("2029-06-01")).toBe(2030);
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2030)).toBe("2030-01-17");
  });
});

describe("the kickoff lands in time to be useful", () => {
  it("gives the board a meeting before nominations must open", () => {
    // For a January AGM, nominations open in late September, so the task has to
    // be raised at the August meeting — not September, by which time the
    // Nominating Committee should already exist.
    const agm = resolveAgmDate(CSC_ELECTIONS_CONFIG, 2027)!;
    const schedule = deriveSchedule(agm, CSC_ELECTIONS_CONFIG);
    expect(schedule.nominationsOpenAt).toBe("2026-09-23");
    // The August meeting (2026-08-27) precedes it; the September one (09-24) does not.
    expect("2026-08-27" <= schedule.nominationsOpenAt).toBe(true);
    expect("2026-09-24" <= schedule.nominationsOpenAt).toBe(false);
  });
});


/**
 * Whether a meeting is a sensible place to raise the kickoff. Mirrors the rule
 * in ensureElectionKickoff without needing a database.
 */
const MAX_KICKOFF_LEAD_DAYS = 150;
function usableMeeting(meetingDate: string, nominationsOpenAt: string): boolean {
  const gap =
    (Date.parse(`${nominationsOpenAt}T00:00:00Z`) - Date.parse(`${meetingDate}T00:00:00Z`)) /
    86_400_000;
  return gap >= 0 && gap <= MAX_KICKOFF_LEAD_DAYS;
}

describe("choosing where to raise the kickoff", () => {
  const nominationsOpen = "2026-09-23";

  it("takes the August meeting — close enough to act on", () => {
    expect(usableMeeting("2026-08-27", nominationsOpen)).toBe(true);
  });

  it("refuses a meeting from the previous year", () => {
    // Board meetings come from Google Calendar and next year's are scheduled
    // late, so "the last meeting before September 2027" can resolve to December
    // 2026. Technically earlier; useless as an agenda item, and nobody would
    // look at that meeting again.
    expect(usableMeeting("2026-12-17", "2027-09-22")).toBe(false);
  });

  it("refuses a meeting AFTER nominations open", () => {
    // An item first raised after its own deadline is an autopsy.
    expect(usableMeeting("2026-09-24", nominationsOpen)).toBe(false);
  });

  it("accepts a meeting on the boundary", () => {
    expect(usableMeeting("2026-04-26", nominationsOpen)).toBe(true); // 150 days
    expect(usableMeeting("2026-04-25", nominationsOpen)).toBe(false); // 151
  });
});
