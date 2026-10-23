import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Check-in cards (Stephen, 2026-10-21): scanning a booth's card counts the
 * meeting happening there NOW, for whoever scanned (the delegate themselves, or
 * the exhibitor confirming), and nothing else. A second scan is "already
 * counted", never a second row.
 */

vi.mock("server-only", () => ({}));

const NOW = new Date("2027-02-02T15:05:00Z");
type Row = Record<string, unknown>;
let people: Row[] = [];
let agendaByPerson: Record<string, unknown> = {};
let checkIns: Row[] = [];
const inserted: Row[] = [];

const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: "meeting-assignment-sch-1",
  source: "meeting_assignment",
  startsAt: "2027-02-02T15:00:00Z",
  endsAt: "2027-02-02T15:20:00Z",
  meetingAssignment: {
    scheduleId: "sch-1",
    suiteId: "suite-100",
    exhibitorSeatId: "seat-exh",
    exhibitorName: "Niagara River Trading",
    delegateSeatIds: ["seat-del"],
  },
  ...overrides,
});

vi.mock("@/lib/conference/person-agenda", () => ({
  loadPersonAgenda: async (personId: string) => ({ success: true, data: agendaByPerson[personId] }),
}));
vi.mock("@/lib/conference/seats", () => ({
  ENTITY_SELECT: "",
  buildEntityGraph: () => [],
  loadSeatHoldings: async () => ({
    seats: [{ seatId: "seat-del", holderPersonId: "p-del", holderName: "Dana Delegate" }],
    entitiesById: new Map(),
  }),
}));
vi.mock("@/lib/conference/member-map", () => ({
  loadMemberMap: async () => ({ things: [{ label: "100", orgName: "Niagara River Trading", orgSlug: "niagara" }] }),
}));
vi.mock("@/lib/conference/badges/checkin", () => ({ personReachesEntity: async () => true }));
vi.mock("@/lib/conference/badges/tokens", () => ({ publicScanBase: () => "https://csc.test" }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const rows = (): Row[] => {
        const source =
          table === "conference_people"
            ? people
            : table === "conference_suites"
              ? [{ id: "suite-100", conference_id: "conf-1", suite_number: 100 }]
              : table === "conference_check_in_events"
                ? checkIns
                : [];
        return source.filter((r) => filters.every(([k, v]) => r[k] === undefined || r[k] === v));
      };
      for (const m of ["select", "limit", "in", "order"]) b[m] = () => b;
      b.eq = (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.insert = (row: Row) => {
        inserted.push(row);
        checkIns.push(row);
        return Promise.resolve({ error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  }),
}));

const { resolveBoothScan, recordCardCheckIn, takesCheckInCards } = await import("../check-in-cards");

beforeEach(() => {
  people = [{ id: "p-del", display_name: "Dana", person_kind: "delegate", conference_id: "conf-1", user_id: "u-del" }];
  agendaByPerson = { "p-del": { items: [meeting()], meetingSeatId: "seat-del" } };
  checkIns = [];
  inserted.length = 0;
});

describe("scanning a booth's check-in card", () => {
  it("a delegate with a meeting there now is offered their meeting", async () => {
    const scan = await resolveBoothScan("suite-100", "u-del", NOW);
    expect(scan).toMatchObject({ mode: "attendee", personId: "p-del", scheduleId: "sch-1", counted: false });
  });

  it("an hour later the same card counts nothing: it goes to the company", async () => {
    const scan = await resolveBoothScan("suite-100", "u-del", new Date("2027-02-02T16:30:00Z"));
    expect(scan).toMatchObject({ mode: "none", orgSlug: "niagara" });
  });

  it("a meeting at ANOTHER booth is not this booth's", async () => {
    agendaByPerson["p-del"] = { items: [meeting({ meetingAssignment: { ...meeting().meetingAssignment, suiteId: "suite-200" } })], meetingSeatId: "seat-del" };
    expect((await resolveBoothScan("suite-100", "u-del", NOW)).mode).toBe("none");
  });

  it("the exhibitor scanning their own card sees who to confirm", async () => {
    people = [{ id: "p-exh", display_name: "Erin", person_kind: "exhibitor", conference_id: "conf-1", user_id: "u-exh" }];
    agendaByPerson = { "p-exh": { items: [meeting()], meetingSeatId: "seat-exh" } };
    const scan = await resolveBoothScan("suite-100", "u-exh", NOW);
    expect(scan).toMatchObject({ mode: "exhibitor", delegates: [{ personId: "p-del", name: "Dana Delegate", confirmedByYou: false }] });
  });
});

describe("recording a card check-in", () => {
  it("writes once per person, meeting and side; a second scan is already counted", async () => {
    const first = await recordCardCheckIn({ conferenceId: "conf-1", personId: "p-del", byUserId: "u-del", scheduleId: "sch-1", confirmedBy: "attendee", resultState: "valid" });
    const again = await recordCardCheckIn({ conferenceId: "conf-1", personId: "p-del", byUserId: "u-del", scheduleId: "sch-1", confirmedBy: "attendee", resultState: "valid" });
    expect(first).toEqual({ error: null, alreadyCounted: false });
    expect(again).toEqual({ error: null, alreadyCounted: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ schedule_id: "sch-1", confirmed_by: "attendee", check_in_source: "qr", is_test: false });
  });

  it("the exhibitor's confirmation is its own row beside the delegate's", async () => {
    await recordCardCheckIn({ conferenceId: "conf-1", personId: "p-del", byUserId: "u-del", scheduleId: "sch-1", confirmedBy: "attendee", resultState: "valid" });
    const exhibitor = await recordCardCheckIn({ conferenceId: "conf-1", personId: "p-del", byUserId: "u-exh", scheduleId: "sch-1", confirmedBy: "exhibitor", resultState: "valid" });
    expect(exhibitor.alreadyCounted).toBe(false);
    expect(inserted.map((r) => r.confirmed_by)).toEqual(["attendee", "exhibitor"]);
  });
});

describe("which events take a card", () => {
  it("only those marked yes in the Build tab", () => {
    expect(takesCheckInCards({ check_in_card: "yes" })).toBe(true);
    expect(takesCheckInCards({ check_in_card: " Yes " })).toBe(true);
    expect(takesCheckInCards({ check_in_card: "no" })).toBe(false);
    expect(takesCheckInCards({})).toBe(false);
  });
});
