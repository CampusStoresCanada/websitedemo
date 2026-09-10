import { describe, expect, it, vi, beforeEach } from "vitest";

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

/** Minimal db: only the two reads schedule-delivery makes. */
function fakeDb(contacts: Array<{ id: string; email: string | null; first_name: string; last_name: string }>) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              if (table === "contacts") {
                return Promise.resolve({ data: contacts.filter((c) => ids.includes(c.id)) });
              }
              return Promise.resolve({
                data: ids.map((id) => ({ id, name: `Org ${id}` })),
              });
            },
          };
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
