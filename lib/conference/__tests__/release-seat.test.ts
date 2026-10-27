import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Releasing somebody's last seat takes them off the roster (Stephen,
 * 2026-10-21: "otherwise we're printing badges for people who don't exist"),
 * unless the entry carries history a delete would destroy (a check-in, badge
 * scans, exhibitor leads). Deleting a contact releases every seat they hold.
 */

type Seat = { id: string; entity_id: string; kind: string; holder: string | null };
let seats: Seat[] = [];
let person: Record<string, unknown> | null = null;
let scans = 0;
let leads = 0;
const deleted: string[] = [];
const markedUnassigned: string[] = [];
const freedIncluded: string[] = [];

vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/conference/included-seats", () => ({
  freeIncludedEvents: async (_db: unknown, _conf: string, seatId: string) => {
    freedIncluded.push(seatId);
  },
}));
vi.mock("@/lib/conference/seats", () => ({
  loadSeatHoldings: async (_db: unknown, q: { seatIds?: string[]; holderPersonId?: string }) => ({
    seats: seats
      .filter((s) => !q.seatIds || q.seatIds.includes(s.id))
      .filter((s) => !q.holderPersonId || s.holder === q.holderPersonId)
      .map((s) => ({ seatId: s.id, entityId: s.entity_id, entityKind: s.kind, holderPersonId: s.holder, organizationId: "org-1" })),
    entitiesById: new Map(),
  }),
  setSeatHolder: async (_db: unknown, seatId: string, personId: string | null) => {
    const seat = seats.find((s) => s.id === seatId);
    if (seat) seat.holder = personId;
    return { changed: true, error: null };
  },
}));

function fakeDb() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let isDelete = false;
      let patch: Record<string, unknown> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      };
      b.delete = () => {
        isDelete = true;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: table === "conference_people" ? person : null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => {
        if (isDelete) deleted.push(String(filters.id));
        if (patch?.person_kind === "unassigned") markedUnassigned.push(String(filters.id));
        const count = table === "conference_badge_scans" ? scans : table === "conference_lead_disclosures" ? leads : null;
        const data = table === "conference_people" && filters.canonical_person_id ? [{ id: "cp-1", conference_id: "conf-1" }] : null;
        return Promise.resolve({ data, error: null, count }).then(resolve);
      };
      return b;
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => fakeDb() as any;

const { releaseSeat, releaseSeatsForContact } = await import("../release-seat");

beforeEach(() => {
  seats = [
    { id: "reg-1", entity_id: "full", kind: "registration", holder: "cp-1" },
    { id: "mg-1", entity_id: "meet", kind: "event", holder: null },
  ];
  person = { id: "cp-1", checked_in_at: null, source_type: "manual" };
  scans = 0;
  leads = 0;
  deleted.length = 0;
  markedUnassigned.length = 0;
  freedIncluded.length = 0;
});

describe("releasing a seat", () => {
  it("takes somebody with no other seat and no history off the roster, and frees what their registration included", async () => {
    const res = await releaseSeat(db(), "conf-1", "reg-1", "admin-1");
    expect(res.ok).toBe(true);
    expect(freedIncluded).toEqual(["reg-1"]);
    expect(deleted).toEqual(["cp-1"]);
  });

  it("keeps somebody who still holds another seat", async () => {
    seats[1].holder = "cp-1";
    // An event seat released on its own leaves their registration in place.
    await releaseSeat(db(), "conf-1", "mg-1", "admin-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned).toEqual([]);
  });

  it("keeps a checked-in person's entry, marked unassigned", async () => {
    person = { ...person, checked_in_at: "2027-02-01T15:00:00Z" };
    await releaseSeat(db(), "conf-1", "reg-1", "admin-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned).toEqual(["cp-1"]);
  });

  it("never deletes an entry exhibitors scanned: their leads would go with it", async () => {
    scans = 2;
    leads = 1;
    await releaseSeat(db(), "conf-1", "reg-1", "admin-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned).toEqual(["cp-1"]);
  });
});

describe("deleting a contact", () => {
  it("releases every seat they hold and takes them off the roster", async () => {
    seats[1].holder = "cp-1";
    await releaseSeatsForContact(db(), "contact-1", "admin-1");
    expect(seats.every((s) => s.holder === null)).toBe(true);
    expect(deleted).toEqual(["cp-1"]);
  });
});
