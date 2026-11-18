import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Archiving used to be a direct database edit that left the membership and its
 * invoices alone. Momentec stayed `active` with $600 open for three months
 * after it was archived. What is worth pinning: an archive ends the membership,
 * never goes around money owing or coverage paid for, and leaves a record.
 */

const {
  requireAuthenticatedMock,
  isGlobalAdminMock,
  createAdminClientMock,
  transitionMembershipStateMock,
  logAuditEventSafeMock,
  logRenewalContactMock,
} = vi.hoisted(() => ({
  logRenewalContactMock: vi.fn(),
  requireAuthenticatedMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  transitionMembershipStateMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  isGlobalAdmin: isGlobalAdminMock,
  canManageOrganization: vi.fn(() => true),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: logAuditEventSafeMock }));
vi.mock("@/lib/renewal/outreach", () => ({ logRenewalContact: logRenewalContactMock }));
vi.mock("@/lib/renewal/board-report", () => ({
  resolveBoardRenewalWindow: vi.fn(async () => ({ renewalYear: 2027, cycleStart: new Date() })),
}));
vi.mock("@/lib/stripe/billing", () => ({
  createProgramInvoice: vi.fn(),
  finalizeAndSendInvoice: vi.fn(),
  setInvoicePayer: vi.fn(),
}));
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));
vi.mock("@/lib/membership/renewal-activation", () => ({ computeNewExpiresAt: vi.fn() }));
vi.mock("@/lib/policy/engine", () => ({
  getActivePolicySet: vi.fn(),
  getEffectivePolicy: vi.fn(),
  getRenewalConfig: vi.fn(),
}));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/renewal/jobs", () => ({ resolveRenewalRecipients: vi.fn() }));
vi.mock("@/lib/renewal/opt-out-scope", () => ({ resolveOptOutScope: vi.fn() }));

import { archiveOrganization } from "../renewal";

const ORG = "org-momentec";

function isoOffsetDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
}

function dbReturning(
  org: Record<string, unknown>,
  opts: {
    openInvoices?: Array<{ id: string; total_cents: number }>;
    invoiceError?: string;
  } = {}
) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    updates,
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: org, error: null }) }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({
              in: async () =>
                opts.invoiceError
                  ? { data: null, error: { message: opts.invoiceError } }
                  : { data: opts.openInvoices ?? [], error: null },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return db;
}

const base = {
  id: ORG,
  name: "Momentec",
  type: "Vendor Partner",
  membership_status: "active",
  membership_expires_at: null,
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthenticatedMock.mockResolvedValue({
    ok: true,
    ctx: { userId: "steve", globalRole: "super_admin" },
  });
  isGlobalAdminMock.mockReturnValue(true);
  transitionMembershipStateMock.mockResolvedValue({ success: true });
  logRenewalContactMock.mockResolvedValue({ success: true, id: "log-1" });
});

describe("archiveOrganization, kept as a prospect", () => {
  it("turns a partner into a prospective partner instead of hiding it", async () => {
    const db = dbReturning(base);
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Budget cut", { keepAsProspect: true });

    expect(result).toEqual({ success: true });
    // Still ends the membership.
    expect(transitionMembershipStateMock).toHaveBeenCalledWith(
      ORG, "canceled", "admin", "steve", "Archived: Budget cut", { archived: true }
    );
    // The Prospects list skips archived companies, so it must NOT be archived.
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].type).toBe("Prospective Partner");
    expect(db.updates[0]).not.toHaveProperty("archived_at");
    // Why they left lands in the call history the caller reads.
    expect(logRenewalContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        renewalYear: 2027,
        note: "Former partner, moved to prospects: Budget cut",
      })
    );
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization_made_prospect",
        details: expect.objectContaining({ type_before: "Vendor Partner" }),
      })
    );
  });

  it("turns a member into a prospective member", async () => {
    const db = dbReturning({ ...base, type: "Member", membership_status: "canceled" });
    createAdminClientMock.mockReturnValue(db);

    await archiveOrganization(ORG, "Store closed, reopening next year", { keepAsProspect: true });

    expect(db.updates[0].type).toBe("Prospective Member");
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("keeps the same refusals: money owing stops it", async () => {
    const db = dbReturning(base, { openInvoices: [{ id: "inv-1", total_cents: 67800 }] });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone", { keepAsProspect: true });

    expect(result.success).toBe(false);
    expect(db.updates).toHaveLength(0);
    expect(logRenewalContactMock).not.toHaveBeenCalled();
  });

  it("refuses a type that has no prospect form", async () => {
    const db = dbReturning({ ...base, type: "Staff" });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone", { keepAsProspect: true });

    expect(result.success).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
});

describe("archiveOrganization", () => {
  it("ends an unpaid active membership, archives, and records who and why", async () => {
    const db = dbReturning(base);
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "  Closed their Canadian office  ");

    expect(result).toEqual({ success: true });
    expect(transitionMembershipStateMock).toHaveBeenCalledWith(
      ORG,
      "canceled",
      "admin",
      "steve",
      "Archived: Closed their Canadian office",
      { archived: true }
    );
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].archived_at).toEqual(expect.any(String));
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization_archived",
        entityId: ORG,
        actorId: "steve",
        details: expect.objectContaining({
          reason: "Closed their Canadian office",
          status_before: "active",
          membership_canceled: true,
        }),
      })
    );
  });

  it("refuses while an invoice is still open, and says how much", async () => {
    const db = dbReturning(base, { openInvoices: [{ id: "inv-1", total_cents: 60000 }] });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone");

    expect(result.success).toBe(false);
    expect(result.error).toContain("an open invoice ($600.00)");
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("refuses when the invoices cannot be read, rather than archive blind", async () => {
    const db = dbReturning(base, { invoiceError: "Bad Request" });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone");

    expect(result.success).toBe(false);
    expect(db.updates).toHaveLength(0);
  });

  it("refuses to cancel coverage that has been paid for", async () => {
    const db = dbReturning({ ...base, membership_expires_at: isoOffsetDays(200) });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone");

    expect(result.success).toBe(false);
    expect(result.error).toContain("paid coverage");
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("archives an already cancelled organization without another status change", async () => {
    const db = dbReturning({ ...base, membership_status: "canceled" });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Tidying");

    expect(result).toEqual({ success: true });
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(1);
  });

  it("does not archive when the cancellation fails", async () => {
    transitionMembershipStateMock.mockResolvedValue({ success: false, error: "nope" });
    const db = dbReturning(base);
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Gone");

    expect(result).toEqual({ success: false, error: "nope" });
    expect(db.updates).toHaveLength(0);
    expect(logAuditEventSafeMock).not.toHaveBeenCalled();
  });

  it("needs a reason and a global admin", async () => {
    createAdminClientMock.mockReturnValue(dbReturning(base));
    expect((await archiveOrganization(ORG, "   ")).error).toBe("A reason is required");

    isGlobalAdminMock.mockReturnValue(false);
    expect((await archiveOrganization(ORG, "Gone")).success).toBe(false);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("refuses an organization that is already archived", async () => {
    const db = dbReturning({ ...base, archived_at: "2026-08-04T00:00:00Z" });
    createAdminClientMock.mockReturnValue(db);

    const result = await archiveOrganization(ORG, "Again");

    expect(result.success).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
});
