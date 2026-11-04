import { describe, expect, it, vi } from "vitest";

/**
 * The CANCOLL attendance report lists the same delegates as the registration
 * report, every one of them (it is proof for billing, not a consent-gated
 * share), with what happened at each partner meeting and at the AGM.
 */

const PAST = "2026-01-01T15:00:00Z";
const FUTURE = "2099-01-01T15:00:00Z";

vi.mock("@/lib/conference/seats", () => ({
  loadSeatHoldings: async () => ({
    seats: [],
    entitiesById: new Map<string, unknown>([
      ["offer-funded", { id: "offer-funded", kind: "registration", attributes: { funds_offer_id: "offer-base" }, refs: [
        { role: "includes", toEntityId: "keynote" },
        { role: "involved_in", toEntityId: "agm" },
      ] }],
      ["offer-base", { id: "offer-base", kind: "registration", attributes: {}, refs: [{ role: "includes", toEntityId: "keynote" }] }],
      ["agm", { id: "agm", kind: "event", attributes: {}, refs: [] }],
      ["keynote", { id: "keynote", kind: "event", attributes: {}, refs: [] }],
    ]),
  }),
}));
vi.mock("@/lib/conference/schedule-service", () => ({
  getConferenceScheduleTimeline: async () => ({
    programItems: [{ id: "agm", startsAt: PAST }],
    meetingAssignmentItems: [
      { startsAt: PAST, meetingAssignment: { scheduleId: "m1", delegateSeatIds: ["seat-a"] } },
      { startsAt: PAST, meetingAssignment: { scheduleId: "m2", delegateSeatIds: ["seat-a"] } },
      { startsAt: FUTURE, meetingAssignment: { scheduleId: "m3", delegateSeatIds: ["seat-b"] } },
    ],
  }),
}));
vi.mock("@/lib/conference/schedule-ops", () => ({
  loadMeetingConfirmations: async () =>
    new Map([
      ["m1", { confirmedPersonIds: ["person-a"], rulings: {} }],
      ["m2", { confirmedPersonIds: [], rulings: { "person-a": { ruling: "excused" } } }],
    ]),
}));

const { cancollAttendanceCsv } = await import("../cancoll-report");

const db = {
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order"]) chain[name] = () => chain;
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [] });
    return chain;
  },
} as never;

const row = (over: Record<string, unknown>) => ({
  seatId: "seat-a",
  organizationId: "o1",
  holderPersonId: "person-a",
  entityId: "offer-funded",
  institution: "Keyano College",
  delegateName: "Pat Buyer",
  positionTitle: "Store Manager",
  confirmedAt: "2026-11-14T18:00:00Z",
  invoiceId: null,
  invoiceNumber: null,
  refund: null,
  ...over,
});

const billing = (rows: ReturnType<typeof row>[]) =>
  ({ conferenceId: "conf", offerId: "offer-funded", rows }) as never;

const parse = (csv: string) => csv.split("\n").map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "")));

describe("cancollAttendanceCsv", () => {
  it("counts each meeting and the AGM, and only the AGM is what funding adds", async () => {
    const [header, a] = parse(await cancollAttendanceCsv(db, billing([row({})])));
    expect(header[0]).toBe("Institution");
    // Two meetings (attended, excused) and the AGM, past with no scan.
    expect(a).toEqual(["Keyano College", "Pat Buyer", "Store Manager", "3", "1", "1", "1", "0", "Not attended", "Non-attendance recorded"]);
  });

  it("lists every funded delegate, including one not yet named", async () => {
    const rows = parse(
      await cancollAttendanceCsv(
        db,
        billing([
          row({ seatId: "seat-b", holderPersonId: "person-b", institution: "Lakeland College", delegateName: "Sam" }),
          row({ seatId: "seat-c", holderPersonId: null, institution: "Mohawk College", delegateName: null }),
        ])
      )
    );
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 2)).toEqual(["Lakeland College", "Sam"]);
    expect(rows[1][9]).toBe("Non-attendance recorded"); // the AGM is past, the meeting ahead
    expect(rows[1][7]).toBe("1");
    expect(rows[2][9]).toBe("No delegate named");
  });
});
