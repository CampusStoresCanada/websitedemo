import { describe, expect, it } from "vitest";
import { sessionMatchesMeetingWindow } from "../meeting-geometry";

/**
 * CSC 2027's Tuesday, verbatim from the Day thing.
 */
const MEETING_DAY = {
  date: "2027-02-02",
  meeting_count: 23,
  meeting_windows: [
    { start_time: "09:30", end_time: "10:45" },
    { start_time: "11:00", end_time: "12:15" },
    { start_time: "13:30", end_time: "14:45" },
    { start_time: "15:00", end_time: "16:00" },
    { start_time: "16:15", end_time: "17:15" },
  ],
  meeting_start_time: "09:30",
  meeting_end_time: "17:15",
  slot_duration_minutes: 12,
  meeting_buffer_minutes: 3,
};

const PLAIN_DAY = { date: "2027-02-03" };

describe("sessionMatchesMeetingWindow", () => {
  it("matches a curated meeting block", () => {
    expect(
      sessionMatchesMeetingWindow({ start_time: "09:30", end_time: "10:45" }, MEETING_DAY)
    ).toBe(true);
  });

  it("matches every window, not just the first", () => {
    for (const w of MEETING_DAY.meeting_windows) {
      expect(
        sessionMatchesMeetingWindow({ start_time: w.start_time, end_time: w.end_time }, MEETING_DAY)
      ).toBe(true);
    }
  });

  it("⛔ does NOT match 'Get Organized' — the 15 minutes before block 1", () => {
    /**
     * The regression this exists for. Testing "is it on the meeting day" instead
     * of "is it a meeting window" put three Campus Stores Canada staff — the
     * association that RUNS the conference — into supplier meetings as buyers,
     * because a Staff Registration reaches Get Organized and Get Organized is on
     * Tuesday.
     */
    expect(
      sessionMatchesMeetingWindow({ start_time: "09:15", end_time: "09:30" }, MEETING_DAY)
    ).toBe(false);
  });

  it("⛔ does NOT match 'Move-in - Tuesday', which spans the whole day", () => {
    // Containing every window is not being one.
    expect(
      sessionMatchesMeetingWindow({ start_time: "09:00", end_time: "17:30" }, MEETING_DAY)
    ).toBe(false);
  });

  it("does not match a session on a day with no meeting cadence", () => {
    expect(
      sessionMatchesMeetingWindow({ start_time: "09:30", end_time: "10:45" }, PLAIN_DAY)
    ).toBe(false);
  });

  it("does not match an untimed session", () => {
    expect(sessionMatchesMeetingWindow({}, MEETING_DAY)).toBe(false);
  });
});
