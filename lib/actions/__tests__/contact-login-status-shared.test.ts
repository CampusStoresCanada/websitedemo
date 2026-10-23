import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ Whoever holds a login keeps it (project_shared_email_walkup_rules). When
 * an org admin gives a second person a shared address, the contact editor
 * must say the login is the OTHER person's, not that this one "has a login".
 */

let contactRow: Record<string, unknown> = {};
let holder: { id: string; name: string } | null = null;

vi.mock("@/lib/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "admin-1" } }),
  canManageOrganization: () => true,
}));
vi.mock("@/lib/circle/sync", () => ({ enqueueCircleSync: async () => undefined }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: async () => ({ success: true }) }));
vi.mock("../../supabase/user-lookup", () => ({ findUserByEmail: async () => ({ id: "user-holder" }) }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { last_sign_in_at: "2026-10-01" } } }) } },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      for (const op of ["eq", "is", "neq", "limit"]) {
        b[op] = (col: string, val: unknown) => {
          filters[`${op}:${col}`] = val;
          return b;
        };
      }
      b.maybeSingle = () => {
        if (table === "organizations") return Promise.resolve({ data: { membership_status: "active" }, error: null });
        if (table === "user_organizations") return Promise.resolve({ data: { role: "member", status: "active" }, error: null });
        if (table === "contacts" && filters["eq:profile_id"]) return Promise.resolve({ data: holder, error: null });
        if (table === "contacts") return Promise.resolve({ data: contactRow, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    },
  }),
}));

beforeEach(() => {
  contactRow = { email: null, work_email: "front@store.test", contact_type: ["directory"], profile_id: null };
  holder = { id: "contact-holder", name: "Desmond Holder" };
});

const status = async () => {
  const { getContactLoginStatus } = await import("../user-management");
  return getContactLoginStatus("org-1", "contact-walkup");
};

describe("login status on a shared address", () => {
  it("names the person who holds the login, and does not claim it for this contact", async () => {
    const res = await status();
    expect(res.status).toMatchObject({ hasAccount: false, membership: null, loginHeldBy: "Desmond Holder" });
  });

  it("is this contact's own login when it is stamped on them", async () => {
    contactRow = { ...contactRow, profile_id: "user-holder" };
    const res = await status();
    expect(res.status).toMatchObject({ hasAccount: true, membership: { role: "member", status: "active" } });
    expect(res.status?.loginHeldBy ?? null).toBeNull();
  });
});
