import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ Releasing somebody's last seat takes them off the roster (Stephen,
 * 2026-10-21: "otherwise we're printing badges for people who don't exist"),
 * unless the entry carries history a delete would destroy (a check-in, badge
 * scans, exhibitor leads). Then it stays, marked unassigned.
 */

let otherSeats = 0;
let person: Record<string, unknown> | null = null;
let scans = 0;
let leads = 0;
const deleted: string[] = [];
const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "admin-1", globalRole: "super_admin" } }),
  canManageOrganization: () => true,
  isGlobalAdmin: () => true,
  isConferenceDeskStaff: async () => true,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      let isDelete = false;
      let head = false;
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.delete = () => {
        isDelete = true;
        return b;
      };
      b.single = () =>
        Promise.resolve({
          data:
            table === "entity_balance_seats"
              ? { organization_id: "org-1", conference_id: "conf-1", holder_person_id: "cp-1" }
              : null,
          error: null,
        });
      b.maybeSingle = () => Promise.resolve({ data: table === "conference_people" ? person : null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => {
        if (patch) updates.push({ table, patch });
        if (isDelete) deleted.push(String(filters.id));
        const count =
          table === "entity_balance_seats"
            ? otherSeats
            : table === "conference_badge_scans"
              ? scans
              : table === "conference_lead_disclosures"
                ? leads
                : 0;
        return Promise.resolve({ data: null, error: null, count: head ? count : null }).then(resolve);
      };
      return b;
    },
  }),
}));

const { deallocateSeat } = await import("../conference-entity-commerce");

beforeEach(() => {
  otherSeats = 0;
  person = { id: "cp-1", checked_in_at: null, source_type: "manual" };
  scans = 0;
  leads = 0;
  deleted.length = 0;
  updates.length = 0;
});

const markedUnassigned = () =>
  updates.some((u) => u.table === "conference_people" && u.patch.person_kind === "unassigned");

describe("releasing a seat", () => {
  it("takes somebody with no other seat and no history off the roster", async () => {
    const res = await deallocateSeat("seat-1");
    expect(res.success).toBe(true);
    expect(deleted).toEqual(["cp-1"]);
  });

  it("keeps somebody who still holds another seat", async () => {
    otherSeats = 1;
    await deallocateSeat("seat-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned()).toBe(false);
  });

  it("keeps a checked-in person's entry, marked unassigned", async () => {
    person = { ...person, checked_in_at: "2027-02-01T15:00:00Z" };
    await deallocateSeat("seat-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned()).toBe(true);
  });

  it("never deletes an entry exhibitors scanned: their leads would go with it", async () => {
    scans = 2;
    leads = 1;
    await deallocateSeat("seat-1");
    expect(deleted).toEqual([]);
    expect(markedUnassigned()).toBe(true);
  });
});
