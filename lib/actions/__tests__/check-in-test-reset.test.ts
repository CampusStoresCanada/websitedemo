import { describe, expect, it, vi, beforeEach } from "vitest";

// conference-people pulls in the mail layer transitively; the Resend client
// throws at construction without a key. Nothing here sends anything.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * Resetting a rehearsal must be scoped by the FLAG and nothing else.
 *
 * ⛔ This is the one edit that would be catastrophic and silent. A reset scoped
 * by time ("everything checked in today") or by operator would wipe REAL
 * check-ins the moment a desk is rehearsed on a conference morning — which is
 * exactly when a desk gets rehearsed. These tests fail if the flag filter ever
 * comes off either mutation.
 */

type Call = { table: string; op: string; filters: Array<[string, unknown]> };
const calls: Call[] = [];

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceOpsAccess: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "u1" } }),
  isGlobalAdmin: () => true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => {
        call.op = call.op === "select" ? "select" : call.op;
        calls.push(call);
        return b;
      };
      b.update = () => {
        call.op = "update";
        calls.push(call);
        return b;
      };
      b.delete = () => {
        call.op = "delete";
        calls.push(call);
        return b;
      };
      b.eq = (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 2 }).then(resolve);
      return b;
    },
  }),
}));

vi.mock("@/lib/audit", () => ({ logAuditEventSafe: async () => undefined }));

beforeEach(() => {
  calls.length = 0;
});

const load = async () => await import("../conference-people");

describe("resetTestCheckIns", () => {
  it("clears people ONLY where the test flag is set", async () => {
    const { resetTestCheckIns } = await load();
    await resetTestCheckIns("conf-1");
    const update = calls.find((c) => c.table === "conference_people" && c.op === "update");
    expect(update).toBeDefined();
    expect(update!.filters).toContainEqual(["check_in_is_test", true]);
    expect(update!.filters).toContainEqual(["conference_id", "conf-1"]);
  });

  it("deletes events ONLY where the test flag is set", async () => {
    const { resetTestCheckIns } = await load();
    await resetTestCheckIns("conf-1");
    const del = calls.find(
      (c) => c.table === "conference_check_in_events" && c.op === "delete"
    );
    expect(del).toBeDefined();
    expect(del!.filters).toContainEqual(["is_test", true]);
    expect(del!.filters).toContainEqual(["conference_id", "conf-1"]);
  });

  /**
   * ⚠️ A reset in one conference must not reach into another. Both mutations
   * carry the conference id above; this pins that neither is scoped by the flag
   * alone, which would clear every conference's rehearsal at once.
   */
  it("never issues a mutation without a conference scope", async () => {
    const { resetTestCheckIns } = await load();
    await resetTestCheckIns("conf-1");
    for (const call of calls.filter((c) => c.op === "update" || c.op === "delete")) {
      expect(call.filters.map(([column]) => column)).toContain("conference_id");
    }
  });

  it("counts by the flag, scoped to the conference", async () => {
    const { countTestCheckIns } = await load();
    await countTestCheckIns("conf-1");
    const people = calls.find((c) => c.table === "conference_people");
    const events = calls.find((c) => c.table === "conference_check_in_events");
    expect(people!.filters).toContainEqual(["check_in_is_test", true]);
    expect(events!.filters).toContainEqual(["is_test", true]);
  });
});
