import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ⛔ THE TRIGGER IS MOCKED, AND THAT IS NOT A CONVENIENCE.
 *
 * `triggerConferenceScheduleReady` runs `triggerAutomation` with
 * `automationMode: "auto_send"`, which the automation module documents as
 * "creates campaign and sends immediately". There is no dry-run mode and no
 * sandbox address list.
 *
 * ⛔ A DATABASE ROLLBACK DOES NOT UN-SEND AN EMAIL. The transaction trick that
 * makes the swap-commit test safe gives ZERO protection here: the rows would
 * vanish and the mail would still be in somebody's inbox. So this suite never
 * reaches the network at all — the trigger is replaced, and what is asserted is
 * WHO WOULD have been mailed and with WHAT KEY.
 *
 * If this file is ever changed to use the real trigger, it will mail real
 * campus store staff the moment it runs in CI.
 */

const triggerSpy = vi.fn();
const seatsSpy = vi.fn();

vi.mock("@/lib/comms/conference-triggers", () => ({
  triggerConferenceScheduleReady: (...args: unknown[]) => {
    triggerSpy(...args);
    return Promise.resolve();
  },
}));

vi.mock("../seats", () => ({
  loadSeatHoldings: (...args: unknown[]) => {
    seatsSpy(...args);
    return Promise.resolve({ seats: SEATS, entitiesById: new Map() });
  },
}));

type Seat = {
  seatId: string;
  organizationId: string;
  holderPersonId: string | null;
  holderContactId: string | null;
  holderName: string | null;
};

let SEATS: Seat[] = [];

/**
 * Minimal db: the reads schedule-delivery makes. `schedules` is the run being
 * announced, and the rows it returns are what the meeting and day counts are
 * derived from — the numbers the email says out loud.
 */
let RUN_ROWS: Array<{ delegate_seat_ids: string[]; meeting_slots: { day_number: number } }> = [];

function fakeDb(contacts: Array<{ id: string; email: string | null; first_name: string; last_name: string }>) {
  return {
    from(table: string) {
      return {
        select() {
          const chain = {
            eq: () => chain,
            neq: () => Promise.resolve({ data: RUN_ROWS }),
            in(_col: string, ids: string[]) {
              if (table === "contacts") {
                return Promise.resolve({ data: contacts.filter((c) => ids.includes(c.id)) });
              }
              return Promise.resolve({
                data: ids.map((id) => ({ id, name: `Org ${id}` })),
              });
            },
          };
          return chain;
        },
      };
    },
  } as never;
}

import { sendSchedulesForRun } from "../schedule-delivery";

describe("schedule delivery", () => {
  beforeEach(() => {
    triggerSpy.mockClear();
    seatsSpy.mockClear();
    SEATS = [
      { seatId: "s1", organizationId: "o1", holderPersonId: "p1", holderContactId: "c1", holderName: "Ann" },
      { seatId: "s2", organizationId: "o1", holderPersonId: "p2", holderContactId: "c2", holderName: "Bo" },
      { seatId: "s3", organizationId: "o2", holderPersonId: "p3", holderContactId: "c3", holderName: "Cy" },
    ];
  });

  const CONTACTS = [
    { id: "c1", email: "ann@example.test", first_name: "Ann", last_name: "One" },
    { id: "c2", email: null, first_name: "Bo", last_name: "Two" },
    { id: "c3", email: "cy@example.test", first_name: "Cy", last_name: "Three" },
  ];

  it("tells only the seats it was given — a late add is not a re-announcement", async () => {
    const out = await sendSchedulesForRun({
      db: fakeDb(CONTACTS),
      conferenceId: "conf",
      runId: "run-1",
      delegateSeatIds: ["s1"],
    });

    expect(out.sent).toEqual(["s1"]);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    // s3 has a perfectly good email and was still left alone.
    expect(triggerSpy.mock.calls[0][0]).toMatchObject({ attendeeEmail: "ann@example.test" });
  });

  it("carries the runId, so a new run re-sends and the same run does not", async () => {
    await sendSchedulesForRun({
      db: fakeDb(CONTACTS),
      conferenceId: "conf",
      runId: "run-42",
      delegateSeatIds: ["s1"],
    });
    // ⛔ The idempotency key is built from this downstream. If runId stops being
    // passed, the first send becomes permanent and every correction after a late
    // add is silently swallowed.
    expect(triggerSpy.mock.calls[0][0]).toMatchObject({ runId: "run-42", personKey: "p1" });
  });

  it("REPORTS a seat with no email rather than skipping it quietly", async () => {
    const out = await sendSchedulesForRun({
      db: fakeDb(CONTACTS),
      conferenceId: "conf",
      runId: "run-1",
      delegateSeatIds: ["s1", "s2"],
    });

    expect(out.sent).toEqual(["s1"]);
    // Bo has no email. A silent skip here is a person who turns up not knowing
    // where to be, so the caller is handed the seat id.
    expect(out.noEmail).toEqual(["s2"]);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a seat id that matches nothing instead of pretending it sent", async () => {
    const out = await sendSchedulesForRun({
      db: fakeDb(CONTACTS),
      conferenceId: "conf",
      runId: "run-1",
      delegateSeatIds: ["s1", "ghost-seat"],
    });

    expect(out.sent).toEqual(["s1"]);
    expect(out.unknownSeat).toEqual(["ghost-seat"]);
  });

  it("with no seat list, tells everyone holding a seat", async () => {
    const out = await sendSchedulesForRun({
      db: fakeDb(CONTACTS),
      conferenceId: "conf",
      runId: "run-1",
    });

    expect(out.sent).toEqual(["s1", "s3"]);
    expect(out.noEmail).toEqual(["s2"]);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  it("only ever asks for seats that are actually assigned", async () => {
    await sendSchedulesForRun({ db: fakeDb(CONTACTS), conferenceId: "conf", runId: "run-1" });
    // Unassigned seats have no holder to email; asking for them would mean
    // resolving nulls and reporting phantom noEmail entries.
    expect(seatsSpy.mock.calls[0][1]).toMatchObject({ conferenceId: "conf", assigned: true });
  });
});

/**
 * The email says "You have N meetings scheduled across D days". Both numbers
 * come from the run being announced, so the sentence cannot disagree with the
 * schedule the link leads to.
 *
 * ⚠️ This shipped broken TWICE. The trigger passed `my_conference_url` and no
 * counts at all, while the template reads `schedule_url`, `meeting_count` and
 * `day_count`. An unknown variable renders as nothing and raises nothing, so
 * the automation log said `sent` and the mail read "You have  meetings
 * scheduled across  days" with a dead button. Only opening the inbox caught it.
 */
describe("the numbers the schedule email says out loud", () => {
  beforeEach(() => {
    triggerSpy.mockClear();
    SEATS = [
      { seatId: "seat-a", organizationId: "org-1", holderPersonId: "p-a", holderContactId: "c-a", holderName: "A" },
      { seatId: "seat-b", organizationId: "org-1", holderPersonId: "p-b", holderContactId: "c-b", holderName: "B" },
    ];
    // A has three meetings across two days; B has one.
    RUN_ROWS = [
      { delegate_seat_ids: ["seat-a"], meeting_slots: { day_number: 1 } },
      { delegate_seat_ids: ["seat-a"], meeting_slots: { day_number: 1 } },
      { delegate_seat_ids: ["seat-a", "seat-b"], meeting_slots: { day_number: 2 } },
    ];
  });

  const contacts = [
    { id: "c-a", email: "a@example.test", first_name: "A", last_name: "One" },
    { id: "c-b", email: "b@example.test", first_name: "B", last_name: "Two" },
  ];

  it("counts meetings and DISTINCT days per person, not per run", async () => {
    await sendSchedulesForRun({
      db: fakeDb(contacts), conferenceId: "conf-1", runId: "run-1",
    });
    const byName = new Map(
      triggerSpy.mock.calls.map(([arg]) => [(arg as { attendeeName: string }).attendeeName, arg as Record<string, unknown>])
    );
    // Three meetings, but only two days — a person in two rooms on one morning
    // has not been at the conference for three days.
    expect(byName.get("A One")).toMatchObject({ meetingCount: 3, dayCount: 2 });
    expect(byName.get("B Two")).toMatchObject({ meetingCount: 1, dayCount: 1 });
  });

  it("tells someone with no meetings that they have none, rather than nothing", async () => {
    RUN_ROWS = [];
    await sendSchedulesForRun({
      db: fakeDb(contacts), conferenceId: "conf-1", runId: "run-1",
    });
    for (const [arg] of triggerSpy.mock.calls) {
      expect(arg).toMatchObject({ meetingCount: 0, dayCount: 0 });
    }
  });
});

/**
 * Source assertions, because the failure mode is silence: the template reads
 * these three names and a mismatch renders empty rather than throwing.
 */
describe("the schedule email passes the variables the template reads", () => {
  const src = readFileSync("lib/comms/conference-triggers.ts", "utf8");
  const scheduleReady = src.slice(src.indexOf("triggerConferenceScheduleReady"));

  it("passes schedule_url, meeting_count and day_count", () => {
    for (const key of ["schedule_url:", "meeting_count:", "day_count:"]) {
      expect(scheduleReady, `template reads ${key}`).toContain(key);
    }
  });

  it("no longer passes my_conference_url, which the template never read", () => {
    // The KEY, not the word — the comment above it explains the history and
    // should keep saying the name that was wrong.
    expect(scheduleReady).not.toContain("my_conference_url:");
  });

  it("links at the agenda's own anchor, not the checklist's", () => {
    expect(scheduleReady).toContain("/me#my_schedule");
  });
});
