import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ A walk-up named at the desk without an email has no address on their
 * registration to claim it by. When their company's admin adds one and invites
 * them, the login lands on their contact — and at sign-in their registration
 * must find them through that contact, not through an email.
 */

type Filter = { col: string; op: string; val: unknown };
const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Filter[] }> = [];
let contactsForUser: Array<{ id: string }> = [];
let unclaimedRows: Array<{ id: string; conference_id: string; organization_id: string }> = [];
const conferencePeopleQueries: Filter[][] = [];

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({
    ok: true,
    ctx: { userId: "user-new", userEmail: "jordan@store.test", activeOrgIds: ["org-1"] },
  }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "user-new" } }),
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "user-new" } }),
  isGlobalAdmin: () => false,
}));

vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/actions/conference-legal", () => ({
  getMyConferenceLegalGate: async () => ({ success: true, data: { allAccepted: true, missing: [] } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Filter[] = [];
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const op of ["eq", "in", "is", "neq"]) {
        b[op] = (col: string, val: unknown) => {
          filters.push({ col, op, val });
          return b;
        };
      }
      b.select = () => b;
      b.update = (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (mode === "update") {
          updates.push({ table, patch, filters });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (table === "contacts") return Promise.resolve({ data: contactsForUser, error: null }).then(resolve);
        if (table === "conference_people") {
          conferencePeopleQueries.push(filters);
          // The email route finds nothing; the person route finds the walk-up.
          const byPerson = filters.some((f) => f.col === "canonical_person_id");
          return Promise.resolve({ data: byPerson ? unclaimedRows : [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return b;
    },
  }),
}));

beforeEach(() => {
  updates.length = 0;
  conferencePeopleQueries.length = 0;
  contactsForUser = [{ id: "contact-walkup" }];
  unclaimedRows = [{ id: "cp-walkup", conference_id: "conf-1", organization_id: "org-1" }];
});

const finalize = async () => {
  const { finalizePendingConferenceAssignmentsForCurrentUser } = await import("../conference-people");
  return finalizePendingConferenceAssignmentsForCurrentUser();
};

describe("a registration with no email finds its person at sign-in", () => {
  it("claims the walk-up's registration through their own contact", async () => {
    const res = await finalize();
    expect(res.success).toBe(true);
    expect(res.data?.personIds).toEqual(["cp-walkup"]);
    const claim = updates.find((u) => u.table === "conference_people");
    expect(claim?.patch).toMatchObject({ user_id: "user-new" });
    // Only ever an unheld row: never takes one someone already holds.
    expect(claim?.filters).toContainEqual({ col: "user_id", op: "is", val: null });
  });

  it("looks only at rows nobody holds, tied to this person's contacts, not cancelled", async () => {
    await finalize();
    const byPerson = conferencePeopleQueries.find((f) => f.some((x) => x.col === "canonical_person_id"));
    expect(byPerson).toContainEqual({ col: "canonical_person_id", op: "in", val: ["contact-walkup"] });
    expect(byPerson).toContainEqual({ col: "user_id", op: "is", val: null });
    expect(byPerson).toContainEqual({ col: "assignment_status", op: "neq", val: "canceled" });
  });

  it("claims nothing when the login is not on any contact (a shared address stays with its holder)", async () => {
    contactsForUser = [];
    const res = await finalize();
    expect(res.data?.personIds).toEqual([]);
    expect(updates.filter((u) => u.table === "conference_people")).toHaveLength(0);
  });
});
