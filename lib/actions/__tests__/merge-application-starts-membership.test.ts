import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Merging an application into an existing org must bill it only when that org
 * holds no membership.
 *
 * Red River College (2026-10) re-applied as a returning member. The duplicate
 * check matched its old record, a Non-Member with no membership status, and the
 * merge, which assumed any matched org was already billed, granted a login and
 * stopped. RRC was left with nothing to pay and no button anywhere that could
 * start a membership from no status. An org that already holds a membership
 * must still never be charged again by a merge.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  transitionMembershipState: vi.fn(),
  createProgramInvoice: vi.fn(),
  finalizeAndSendInvoice: vi.fn(),
  sendEmail: vi.fn(),
  applicationApprovedEmail: vi.fn(),
  mirrorFieldsToMembership: vi.fn(),
  orgUpdates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth/guards", () => ({
  requireSuperAdmin: vi.fn(async () => ({ ok: true, ctx: { userId: "admin-1" } })),
  requireAdmin: vi.fn(),
  requireAuthenticated: vi.fn(),
  canManageOrganization: vi.fn(),
  isGlobalAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/user-lookup", () => ({
  findUserByEmail: vi.fn(async () => ({ id: "user-ken" })),
}));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: mocks.transitionMembershipState,
}));
vi.mock("@/lib/membership/mirror", () => ({
  mirrorFieldsToMembership: mocks.mirrorFieldsToMembership,
}));
vi.mock("@/lib/membership/renewal-activation", () => ({
  activateMembershipRenewal: vi.fn(),
  computeNewExpiresAt: vi.fn(async () => ({
    billingPeriodStart: "2026-09-01",
    billingPeriodEnd: "2027-08-31",
  })),
  nextCycleStartOnOrAfter: vi.fn(),
  isWithinPreRenewalSkipWindow: vi.fn(() => false),
}));
vi.mock("@/lib/policy/engine", () => ({
  getRenewalConfig: vi.fn(async () => ({
    cycle_start_month_day: "09-01",
    pre_renewal_skip_stub_days: 30,
  })),
}));
vi.mock("@/lib/stripe/billing", () => ({
  createStripeCustomer: vi.fn(),
  createProgramInvoice: mocks.createProgramInvoice,
  finalizeAndSendInvoice: mocks.finalizeAndSendInvoice,
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: mocks.sendEmail,
  applicationApprovedEmail: mocks.applicationApprovedEmail,
  accountInviteEmail: vi.fn(),
  paidBoothWelcomeEmail: vi.fn(),
  verificationEmail: vi.fn(),
  applicationReceivedEmail: vi.fn(),
  adminNewApplicationEmail: vi.fn(),
  applicationRejectedEmail: vi.fn(),
}));
vi.mock("@/lib/identity/lifecycle", () => ({
  ensureKnownPerson: vi.fn(async () => ({ personId: "person-ken" })),
  upsertPersonContact: vi.fn(),
  ensurePersonForUser: vi.fn(async () => ({ personId: "person-ken" })),
  linkUserToPerson: vi.fn(),
}));
vi.mock("@/lib/circle/sync", () => ({ enqueueCircleSync: vi.fn() }));
vi.mock("@/lib/circle/config", () => ({ getAccessGroupIds: vi.fn() }));
vi.mock("@/lib/board/vote-service", () => ({
  markVoteExecuted: vi.fn(),
  withdrawVoteForApplication: vi.fn(),
}));
vi.mock("@/lib/ops/alerts", () => ({
  raiseAlertIfNotOpen: vi.fn(),
  resolveAlertsByRuleKey: vi.fn(),
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// applications.ts pulls in the Stripe client transitively, which throws at import
// time without a key.
vi.mock("@/lib/stripe/client", () => ({ stripe: {}, isTestMode: true }));

import { mergeApplicationIntoOrganization } from "../applications";

const APP = {
  id: "app-1",
  status: "pending_review",
  application_type: "member",
  applicant_email: "khansen2@rrc.ca",
  applicant_name: "Ken Hansen",
  application_data: {
    organization_name: "Red River College Polytechnic",
    website: "https://bookstore.rrc.ca",
    contact_title: "Manager - Campus Store & Print Shoppe",
  },
  paid_at: null,
  paid_booth_entity_id: null,
  paid_conference_id: null,
};

/** Chainable query stand-in: every builder method returns the chain, and the
 *  chain resolves (awaited or via single/maybeSingle) to the table's canned row. */
function mockDb(target: { membership_status: string | null; type: string }) {
  const targetRow = {
    id: "org-rrc",
    name: "Red River Polytech",
    email: null,
    website: "bookstore.rrc.ca",
    fte: 12571,
    is_cancoll_member: false,
    cancoll_tier: null,
    ...target,
  };
  const results: Record<string, { list: unknown; one: unknown }> = {
    signup_applications: { list: null, one: APP },
    organizations: { list: [targetRow], one: targetRow },
    invoices: { list: [], one: null },
    user_organizations: { list: [], one: { user_id: "user-ken" } },
  };

  return {
    from(table: string) {
      const r = results[table] ?? { list: [], one: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "ilike", "in", "order", "limit", "insert"]) {
        chain[m] = () => chain;
      }
      chain.update = (values: Record<string, unknown>) => {
        if (table === "organizations") mocks.orgUpdates.push(values);
        return chain;
      };
      chain.single = async () => ({ data: r.one, error: null });
      chain.maybeSingle = async () => ({ data: r.one, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: r.list, error: null });
      return chain;
    },
    rpc: vi.fn(),
    auth: { admin: { createUser: vi.fn(), generateLink: vi.fn() } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgUpdates.length = 0;
  mocks.transitionMembershipState.mockResolvedValue({ success: true });
  mocks.createProgramInvoice.mockResolvedValue({ id: "inv-1", stripe_invoice_id: "in_123" });
  mocks.applicationApprovedEmail.mockResolvedValue({ subject: "Approved", html: "<p/>" });
});

describe("mergeApplicationIntoOrganization", () => {
  it("starts a membership, invoices and emails when the matched org holds no membership", async () => {
    mocks.createAdminClient.mockReturnValue(mockDb({ membership_status: null, type: "Non-Member" }));

    const result = await mergeApplicationIntoOrganization("app-1", "org-rrc");

    expect(result.success).toBe(true);
    expect(mocks.orgUpdates[0]).toMatchObject({ type: "Member" });
    expect(mocks.transitionMembershipState.mock.calls.map((c) => c[1])).toEqual([
      "applied",
      "approved",
    ]);
    // The invoice prices off the memberships row, which the RPC creates bare.
    expect(mocks.mirrorFieldsToMembership).toHaveBeenCalledWith(
      "org-rrc",
      expect.objectContaining({ fte: 12571 }),
      expect.objectContaining({ orgType: "Member" })
    );
    expect(mocks.mirrorFieldsToMembership.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createProgramInvoice.mock.invocationCallOrder[0]
    );
    expect(mocks.createProgramInvoice).toHaveBeenCalledWith(
      "org-rrc",
      expect.objectContaining({ billingPeriodStart: "2026-09-01" })
    );
    expect(mocks.finalizeAndSendInvoice).toHaveBeenCalledWith("inv-1");
    expect(mocks.applicationApprovedEmail).toHaveBeenCalledWith(
      "Ken Hansen",
      "member",
      "https://invoice.stripe.com/i/in_123"
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "khansen2@rrc.ca", subject: "Approved" })
    );
  });

  it("never bills or re-types an org that already holds a membership", async () => {
    mocks.createAdminClient.mockReturnValue(mockDb({ membership_status: "active", type: "Member" }));

    const result = await mergeApplicationIntoOrganization("app-1", "org-rrc");

    expect(result.success).toBe(true);
    expect(mocks.orgUpdates[0]).not.toHaveProperty("type");
    expect(mocks.transitionMembershipState).not.toHaveBeenCalled();
    expect(mocks.mirrorFieldsToMembership).not.toHaveBeenCalled();
    expect(mocks.createProgramInvoice).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("stops before invoicing if the membership cannot be started", async () => {
    mocks.createAdminClient.mockReturnValue(mockDb({ membership_status: null, type: "Non-Member" }));
    mocks.transitionMembershipState.mockResolvedValueOnce({ success: false, error: "boom" });

    const result = await mergeApplicationIntoOrganization("app-1", "org-rrc");

    expect(result.success).toBe(false);
    expect(mocks.createProgramInvoice).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
