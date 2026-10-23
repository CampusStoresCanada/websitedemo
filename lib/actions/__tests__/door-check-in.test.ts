import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ The event door (Stephen, 2026-10-20): the desk with an event picked.
 *   - a badge SCAN at the door also checks them in to the conference;
 *   - by NAME at the door counts for the event only (no badge was picked up);
 *   - the door asks "is the event in their access?", never the day rule;
 *   - not in their access → let in, recorded as "not on their ticket";
 *   - a second scan at the same door is a re-entry, not a second person.
 */

const inserted: Array<Record<string, unknown>> = [];
let personUpdate: Record<string, unknown> | null = null;
let personRow: Record<string, unknown> = {};
let priorDoorRows: unknown[] = [];
let reaches = true;
let verdict: { admitted: boolean } | null = null;

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  isGlobalAdmin: () => true,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/conference/badges/tokens", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findBadgeTokenRow: async () => ({ id: "token-1", person_id: "p1", conference_id: "conf-1", revoked_at: null }),
}));
vi.mock("@/lib/conference/badges/checkin", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  personReachesEntity: async () => reaches,
  personVerdictToday: async () => verdict,
}));
vi.mock("@/lib/conference/desk-staff", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  conferenceToday: async () => "2027-02-02",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit"]) b[m] = () => b;
      b.insert = (row: Record<string, unknown>) => {
        if (table === "conference_check_in_events") inserted.push(row);
        return Promise.resolve({ data: null, error: null });
      };
      b.update = (patch: Record<string, unknown>) => {
        if (table === "conference_people") personUpdate = patch;
        return b;
      };
      b.maybeSingle = () =>
        Promise.resolve({
          data:
            table === "conference_people"
              ? personRow
              : table === "conference_entities"
                ? { id: "ev-reception" }
                : null,
          error: null,
        });
      b.single = b.maybeSingle;
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "conference_check_in_events" ? priorDoorRows : [], error: null }).then(resolve);
      return b;
    },
  }),
}));

beforeEach(() => {
  inserted.length = 0;
  personUpdate = null;
  personRow = { id: "p1", conference_id: "conf-1", checked_in_at: null, assignment_status: "assigned" };
  priorDoorRows = [];
  reaches = true;
  verdict = null;
});

const scanAtDoor = async () => {
  const { scanConferenceCheckInToken } = await import("../conference-people");
  return scanConferenceCheckInToken({ conferenceId: "conf-1", qrToken: "sometoken", entityId: "ev-reception" });
};
const nameAtDoor = async () => {
  const { markConferencePersonCheckedInManual } = await import("../conference-people");
  return markConferencePersonCheckedInManual("p1", { entityId: "ev-reception" });
};

describe("scanning a badge at an event's door", () => {
  it("checks them in to the event AND the conference", async () => {
    const res = await scanAtDoor();
    expect(res.data?.state).toBe("valid");
    expect(personUpdate).toMatchObject({ check_in_source: "badge_pickup" });
    expect(inserted.map((r) => [r.result_state, r.entity_id])).toEqual([
      ["valid", null],
      ["valid", "ev-reception"],
    ]);
  });

  it("does not check them in to the conference twice", async () => {
    personRow = { ...personRow, checked_in_at: "2027-02-01T15:00:00Z" };
    await scanAtDoor();
    expect(personUpdate).toBeNull();
    expect(inserted.map((r) => r.entity_id)).toEqual(["ev-reception"]);
  });

  it("lets in someone without the event on their ticket, and records it", async () => {
    reaches = false;
    const res = await scanAtDoor();
    expect(res.data?.state).toBe("not_on_ticket");
    expect(inserted.at(-1)).toMatchObject({ result_state: "not_on_ticket", entity_id: "ev-reception" });
  });

  it("never applies the desk's day rule — a Thursday pass can enter the reception it bought", async () => {
    verdict = { admitted: false };
    const res = await scanAtDoor();
    expect(res.data?.state).toBe("valid");
  });

  it("a second scan at the same door is a re-entry, not another person", async () => {
    priorDoorRows = [{ id: "earlier" }];
    personRow = { ...personRow, checked_in_at: "2027-02-01T15:00:00Z" };
    const res = await scanAtDoor();
    expect(res.data?.state).toBe("already_checked_in");
    expect(inserted).toEqual([expect.objectContaining({ result_state: "already_checked_in", entity_id: "ev-reception" })]);
  });
});

describe("checking someone in by name at an event's door", () => {
  it("counts for the event only — no badge was picked up", async () => {
    const res = await nameAtDoor();
    expect(res.data?.state).toBe("valid");
    expect(personUpdate).toBeNull();
    expect(inserted).toEqual([
      expect.objectContaining({ result_state: "valid", entity_id: "ev-reception", check_in_source: "manual" }),
    ]);
  });

  it("records not-on-ticket the same way a scan does", async () => {
    reaches = false;
    const res = await nameAtDoor();
    expect(res.data?.state).toBe("not_on_ticket");
  });
});
