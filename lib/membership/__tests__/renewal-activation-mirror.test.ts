import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the Phase 4 mirror of `memberships.expires_at`.
 *
 * `memberships.expires_at` was populated by the Stage 0 backfill and then had
 * no continuous writer: `transition_membership_state` never referenced it and
 * `activateMembershipRenewal` — the only writer of
 * `organizations.membership_expires_at` — didn't mirror. So the column was
 * write-once and drifted on every renewal payment (7 rows by 2026-08-18,
 * hand-backfilled; 16 again by 2026-08-31).
 *
 * The bar these tests are written to: a green run must distinguish "the mirror
 * fires" from "the mirror was never reached". So the assertion is on the actual
 * UPDATE payload reaching the `memberships` table, not on a spy over the helper
 * — deleting the mirror call, or dropping `expires_at` from
 * MembershipMirrorFields, both fail this suite.
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
  // The mirror resolves program_key through this rather than hardcoding the
  // org-type literals — so the partner mapping has to be present for the
  // memberships UPDATE to be attempted at all.
  getProgramsConfig: async () => [
    { key: "member", orgTypeValue: "Member" },
    { key: "partner", orgTypeValue: "Vendor Partner" },
  ],
}));

const { activateMembershipRenewal } = await import("../renewal-activation");

type UpdateCall = { table: string; payload: Record<string, unknown> };

/** Records every .update() payload per table; everything else is a no-op stub. */
function stubDb(options?: { membershipsUpdateError?: string }) {
  const updates: UpdateCall[] = [];

  const chain = (table: string) => {
    const result = () => {
      if (table === "memberships" && options?.membershipsUpdateError) {
        return { data: null, error: { message: options.membershipsUpdateError } };
      }
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
      // The activation read; the mirror uses maybeSingle instead.
      single: async () => ({
        data: { membership_status: "grace", membership_expires_at: "2026-08-31" },
        error: null,
      }),
      maybeSingle: async () =>
        table === "organizations"
          ? { data: { type: "Vendor Partner" }, error: null }
          : { data: null, error: null }, // renewal_events: no prior charge_succeeded
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
  idempotencyKey: "in_test_123",
  invoiceId: "inv-1",
};

describe("activateMembershipRenewal → memberships.expires_at mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionMembershipStateMock.mockResolvedValue({ success: true });
    recordRenewalEventMock.mockResolvedValue(undefined);
  });

  it("writes the new expiry to memberships, not just organizations", async () => {
    const { db, updates } = stubDb();
    createAdminClientMock.mockReturnValue(db);

    const result = await activateMembershipRenewal(PARAMS);
    expect(result.success).toBe(true);

    const orgUpdate = updates.find((u) => u.table === "organizations");
    expect(orgUpdate?.payload).toMatchObject({ membership_expires_at: "2027-08-31" });

    // The regression this suite exists for: before 2026-08-31 there was no
    // memberships update here at all.
    const membershipUpdate = updates.find((u) => u.table === "memberships");
    expect(membershipUpdate, "no UPDATE reached memberships — the mirror did not fire").toBeDefined();
    expect(membershipUpdate?.payload).toMatchObject({ expires_at: "2027-08-31" });
  });

  it("mirrors the same value the authoritative organizations write used", async () => {
    const { db, updates } = stubDb();
    createAdminClientMock.mockReturnValue(db);

    await activateMembershipRenewal({ ...PARAMS, newExpiresAt: "2028-08-31" });

    const org = updates.find((u) => u.table === "organizations")?.payload;
    const mem = updates.find((u) => u.table === "memberships")?.payload;
    expect(mem?.expires_at).toBe(org?.membership_expires_at);
  });

  it("does not fail the activation when the mirror write errors", async () => {
    // The mirror is additive and best-effort by contract: a paid org must
    // never be left without its new expiry because the secondary write broke.
    const { db, updates } = stubDb({ membershipsUpdateError: "permission denied" });
    createAdminClientMock.mockReturnValue(db);

    const result = await activateMembershipRenewal(PARAMS);

    expect(result.success).toBe(true);
    expect(updates.find((u) => u.table === "organizations")?.payload).toMatchObject({
      membership_expires_at: "2027-08-31",
    });
  });
});
