import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Rejecting an application mails the applicant, so it must happen exactly once.
 *
 * The status check above the write is a read-then-write: two admins (or two
 * tabs) hitting Reject at the same moment can both read "pending_review" and
 * both proceed. Making the status write itself conditional closes that — it is
 * the first mutation in the function, so it doubles as the lock, and the loser
 * bails before any mail goes out.
 */

const { createAdminClientMock, sendEmailMock, requireAdminMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  sendEmailMock: vi.fn(),
  requireAdminMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/email/send", () => ({ sendEmail: sendEmailMock, sendEmailBatch: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireAdmin: requireAdminMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// applications.ts pulls in the Stripe client transitively, which throws at import
// time without a key. Nothing under test touches it.
vi.mock("@/lib/stripe/client", () => ({ stripe: {}, isTestMode: true }));

/**
 * Filter-aware stand-in. `readStatus` is what the initial SELECT returns (the
 * stale read); `rowStatus` is what the row actually holds by the time the UPDATE
 * runs. The UPDATE only matches when every .eq() it was given matches the row —
 * so a claim that forgets its status filter matches on id alone and wrongly wins.
 */
function mockDb(app: Record<string, unknown> | null, rowStatus: string) {
  const filters: Record<string, unknown> = {};
  const updateChain = {
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return updateChain;
    },
    select: () => {
      const matches = Object.entries(filters).every(([col, val]) =>
        col === "id" ? val === app?.id : val === rowStatus
      );
      return Promise.resolve({ data: matches ? [{ id: app?.id }] : [], error: null });
    },
  };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: app, error: null }) }),
      }),
      update: () => updateChain,
    }),
  };
}

const PENDING_APP = {
  id: "a1",
  status: "pending_review",
  applicant_email: "someone@example.com",
  applicant_name: "Someone",
  application_type: "member",
};

async function rejectApplication(id: string, reason: string) {
  const mod = await import("@/lib/actions/applications");
  return mod.rejectApplication(id, reason);
}

describe("rejectApplication — conditional status claim", () => {
  beforeEach(() => {
    vi.resetModules();
    createAdminClientMock.mockReset();
    sendEmailMock.mockReset();
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ ok: true, ctx: { userId: "admin-1" } });
  });

  it("bails without mailing the applicant when another admin already claimed it", async () => {
    // Stale read says pending_review; the row was rejected a moment ago.
    createAdminClientMock.mockReturnValue(mockDb(PENDING_APP, "rejected"));

    const result = await rejectApplication("a1", "Not eligible this year");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already resolved/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("still refuses an application that is no longer pending", async () => {
    createAdminClientMock.mockReturnValue(mockDb({ ...PENDING_APP, status: "approved" }, "approved"));

    const result = await rejectApplication("a1", "Not eligible this year");

    expect(result.success).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
