import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the revive path: what a payment does to an org that is canceled,
 * archived, or both.
 *
 * Two real orgs sat broken behind this. Both were archived in the 2026-03-10
 * partner cleanup and both then paid a $600 partnership for
 * 2026-08-31 → 2027-08-31:
 *   - Roaring Spring paid 2026-08-31 and stayed `canceled`, because
 *     activateMembershipRenewal's status branch covered grace/locked/approved
 *     only and `canceled` was terminal in ALLOWED_TRANSITIONS.
 *   - McGraw Hill paid 2026-08-11 and stayed archived — `active`, paid,
 *     correct expiry, and invisible to every surface reading through
 *     `active_organizations`.
 *
 * The bar: a green run must distinguish "the revive fires" from "the revive
 * was never reached". Assertions are on the UPDATE payload and the status
 * transition actually requested, not on spies over helpers.
 */

const { createAdminClientMock, transitionMembershipStateMock, recordRenewalEventMock } = vi.hoisted(
  () => ({
    createAdminClientMock: vi.fn(),
    transitionMembershipStateMock: vi.fn(),
    recordRenewalEventMock: vi.fn(),
  })
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: { invoices: { retrieve: vi.fn(), voidInvoice: vi.fn(), del: vi.fn() } },
}));
vi.mock("@/lib/renewal/events", () => ({ recordRenewalEvent: recordRenewalEventMock }));
vi.mock("@/lib/policy/engine", () => ({
  getRenewalConfig: async () => ({ cycle_start_month_day: "09-01" }),
  getProgramsConfig: async () => [
    { key: "member", orgTypeValue: "Member" },
    { key: "partner", orgTypeValue: "Vendor Partner" },
  ],
}));

const { activateMembershipRenewal } = await import("../renewal-activation");
const { ALLOWED_TRANSITIONS } = await import("../types");

type UpdateCall = { table: string; payload: Record<string, unknown> };

/** Records every .update() payload per table, for a caller-supplied org row. */
function stubDb(orgRow: {
  membership_status: string;
  membership_expires_at: string | null;
  archived_at: string | null;
}) {
  const updates: UpdateCall[] = [];

  const chain = (table: string) => {
    const result = () => {
      if (table === "invoices") return { data: [], error: null };
      return { data: null, error: null };
    };

    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      in: () => api,
      neq: () => api,
      contains: () => api,
      limit: () => api,
      insert: async () => result(),
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return api;
      },
      single: async () => ({ data: orgRow, error: null }),
      maybeSingle: async () =>
        table === "organizations"
          ? { data: { type: "Vendor Partner" }, error: null }
          : { data: null, error: null },
      then: (resolve: (v: unknown) => void) => resolve(result()),
    };
    return api;
  };

  return { db: { from: (table: string) => chain(table) }, updates };
}

const PARAMS = {
  organizationId: "org-1",
  newExpiresAt: "2027-08-31",
  billingPeriodStart: "2026-08-31",
  triggeredBy: "stripe_webhook" as const,
  idempotencyKey: "in_test_revive",
  invoiceId: "inv-1",
};

const ARCHIVED_AT = "2026-03-10T14:12:59.032413+00:00";

describe("a payment revives a canceled or archived org", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionMembershipStateMock.mockResolvedValue({ success: true });
    recordRenewalEventMock.mockResolvedValue(undefined);
  });

  it("moves a canceled org to active (the Roaring Spring shape)", async () => {
    const { db } = stubDb({
      membership_status: "canceled",
      membership_expires_at: "2027-08-31",
      archived_at: ARCHIVED_AT,
    });
    createAdminClientMock.mockReturnValue(db);

    const result = await activateMembershipRenewal(PARAMS);
    expect(result.success).toBe(true);

    expect(
      transitionMembershipStateMock,
      "no transition requested — a canceled org that paid stayed canceled"
    ).toHaveBeenCalled();
    const [, newStatus, , , reason] = transitionMembershipStateMock.mock.calls[0];
    expect(newStatus).toBe("active");
    expect(reason).toBe("Payment received after cancellation");
  });

  it("clears archived_at for a paid org that is already active (the McGraw Hill shape)", async () => {
    const { db, updates } = stubDb({
      membership_status: "active",
      membership_expires_at: "2027-08-31",
      archived_at: ARCHIVED_AT,
    });
    createAdminClientMock.mockReturnValue(db);

    await activateMembershipRenewal(PARAMS);

    const orgUpdate = updates.find((u) => u.table === "organizations");
    expect(orgUpdate?.payload).toMatchObject({
      membership_expires_at: "2027-08-31",
      archived_at: null,
    });
    // Status was already correct — the archive was the whole defect, so no
    // transition should be attempted (active → active is not a legal move).
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("does not touch archived_at on an ordinary renewal", async () => {
    const { db, updates } = stubDb({
      membership_status: "grace",
      membership_expires_at: "2026-08-31",
      archived_at: null,
    });
    createAdminClientMock.mockReturnValue(db);

    await activateMembershipRenewal(PARAMS);

    const orgUpdate = updates.find((u) => u.table === "organizations");
    expect(orgUpdate?.payload).toEqual({ membership_expires_at: "2027-08-31" });
    expect(orgUpdate?.payload).not.toHaveProperty("archived_at");
  });

  it("records the previous status and the archive it lifted", async () => {
    const { db } = stubDb({
      membership_status: "canceled",
      membership_expires_at: "2027-08-31",
      archived_at: ARCHIVED_AT,
    });
    createAdminClientMock.mockReturnValue(db);

    await activateMembershipRenewal(PARAMS);

    const metadata = recordRenewalEventMock.mock.calls[0]?.[5];
    expect(metadata).toMatchObject({
      previous_status: "canceled",
      unarchived_from: ARCHIVED_AT,
    });
  });
});

describe("canceled is no longer a dead end", () => {
  it("allows canceled → active", () => {
    expect(ALLOWED_TRANSITIONS.canceled).toContain("active");
  });

  it("still allows nothing else out of canceled", () => {
    // Widening this is a real decision, not a typo — a canceled org must not
    // be able to slide into grace or locked without an explicit payment.
    expect(ALLOWED_TRANSITIONS.canceled).toEqual(["active"]);
  });
});
