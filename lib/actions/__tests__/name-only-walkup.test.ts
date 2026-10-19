import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ A walk-up named at the desk with no email (Stephen, 2026-10-19): a NEW
 * person record so the badge prints, no login and no Circle, and a heads-up
 * to their company's admins. Never matched by name.
 */

let personRow: Record<string, unknown> | null = null;
let linked: Record<string, unknown> | null = null;
const created: Array<{ params: Record<string, unknown>; options: Record<string, unknown> }> = [];
const sent: Array<{ templateKey: string; recipients: Array<{ to: string; variables: Record<string, unknown> }> }> = [];

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  isGlobalAdmin: () => true,
}));

vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));

vi.mock("@/lib/identity/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createKnownPerson: async (params: Record<string, unknown>, options: Record<string, unknown> = {}) => {
    created.push({ params, options });
    return { personId: "contact-new" };
  },
}));

vi.mock("@/lib/comms/audience", () => ({
  resolveAudience: async () => [
    { userId: "a1", email: "admin@store.test", name: "Pat Admin", variableOverrides: { first_name: "Pat" } },
  ],
}));

vi.mock("@/lib/comms/send", () => ({
  sendTransactionalBatch: async (opts: (typeof sent)[number]) => {
    sent.push(opts);
    return opts.recipients.map(() => ({ success: true }));
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "in", "is", "limit"]) b[m] = () => b;
      b.update = (patch: Record<string, unknown>) => {
        if (table === "conference_people") linked = patch;
        return b;
      };
      b.maybeSingle = () =>
        Promise.resolve({
          data:
            table === "conference_people"
              ? personRow
              : table === "organizations"
                ? { name: "Test Store", slug: "test-store" }
                : table === "conference_instances"
                  ? { name: "CSC 2027" }
                  : null,
          error: null,
        });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      return b;
    },
  }),
}));

beforeEach(() => {
  personRow = {
    id: "cp-1",
    conference_id: "conf-1",
    organization_id: "org-1",
    canonical_person_id: null,
    display_name: "Jordan Walkup",
    contact_email: null,
    role_title: null,
  };
  linked = null;
  created.length = 0;
  sent.length = 0;
});

const record = async () => {
  const { recordNameOnlyWalkUp } = await import("../conference-people");
  return recordNameOnlyWalkUp({ conferenceId: "conf-1", conferencePersonId: "cp-1" });
};

describe("a walk-up named without an email", () => {
  it("gets a new person record, linked to their seat, with no Circle account", async () => {
    const res = await record();
    expect(res).toEqual({ success: true, data: { canonicalPersonId: "contact-new", adminsTold: 1 } });
    expect(created).toHaveLength(1);
    expect(created[0].params).toMatchObject({ organizationId: "org-1", name: "Jordan Walkup" });
    expect(created[0].params.email ?? null).toBeNull();
    expect(created[0].options).toEqual({ provisionCircle: false });
    expect(linked).toMatchObject({ canonical_person_id: "contact-new" });
  });

  it("tells their company's admins, by name, with a link to the company", async () => {
    await record();
    expect(sent).toHaveLength(1);
    expect(sent[0].templateKey).toBe("conference_walkup_without_email");
    expect(sent[0].recipients[0].to).toBe("admin@store.test");
    expect(sent[0].recipients[0].variables).toMatchObject({
      first_name: "Pat",
      person_name: "Jordan Walkup",
      organization_name: "Test Store",
      conference_name: "CSC 2027",
    });
    expect(String(sent[0].recipients[0].variables.org_url)).toMatch(/\/org\/test-store$/);
  });

  it("does nothing to someone who already has a person record", async () => {
    personRow = { ...personRow, canonical_person_id: "contact-existing" };
    const res = await record();
    expect(res).toEqual({ success: true, data: { canonicalPersonId: "contact-existing", adminsTold: 0 } });
    expect(created).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses someone who has an email — that is the normal path, with a login", async () => {
    personRow = { ...personRow, contact_email: "jordan@store.test" };
    const res = await record();
    expect(res.success).toBe(false);
    expect(created).toHaveLength(0);
  });
});
