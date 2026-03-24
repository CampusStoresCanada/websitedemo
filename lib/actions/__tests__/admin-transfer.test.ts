import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthenticatedMock,
  isGlobalAdminMock,
  createAdminClientMock,
  enqueueCircleSyncMock,
  sendTransactionalMock,
  resetOnboardingForNewOrgAdminMock,
  getEffectivePolicyMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  enqueueCircleSyncMock: vi.fn(),
  sendTransactionalMock: vi.fn(),
  resetOnboardingForNewOrgAdminMock: vi.fn(),
  getEffectivePolicyMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  isGlobalAdmin: isGlobalAdminMock,
  canManageOrganization: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/circle/sync", () => ({
  enqueueCircleSync: enqueueCircleSyncMock,
}));

vi.mock("@/lib/comms/send", () => ({
  sendTransactional: sendTransactionalMock,
}));

vi.mock("@/lib/actions/applications", () => ({
  resetOnboardingForNewOrgAdmin: resetOnboardingForNewOrgAdminMock,
}));

vi.mock("@/lib/policy/engine", () => ({
  getEffectivePolicy: getEffectivePolicyMock,
}));

import {
  acceptAdminTransfer,
  adminTransferTimeoutCheck,
} from "../admin-transfer";

type AdminTransferRow = {
  id: string;
  organization_id: string;
  from_user_id: string;
  to_user_id: string | null;
  status?: string;
};

function fakeAdminClient(options: {
  transferForAccept?: AdminTransferRow;
  expiredTransfers?: AdminTransferRow[];
  organizationName?: string;
}) {
  return {
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => {
      if (table === "admin_transfer_requests") {
        return {
          select: () => ({
            eq: (_column: string, _value: string) => ({
              single: async () => ({
                data: options.transferForAccept ?? null,
                error: null,
              }),
              lt: async () => ({
                data: options.expiredTransfers ?? [],
                error: null,
              }),
            }),
            lt: async () => ({
              data: options.expiredTransfers ?? [],
              error: null,
            }),
          }),
        };
      }

      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { name: options.organizationName ?? "Org Name" },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    auth: {
      admin: {
        getUserById: vi
          .fn(async (id: string) => ({ data: { user: { id, email: `${id}@x.com` } } })),
      },
    },
  };
}

describe("admin transfer actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGlobalAdminMock.mockReturnValue(false);
    enqueueCircleSyncMock.mockResolvedValue(undefined);
    sendTransactionalMock.mockResolvedValue(undefined);
    resetOnboardingForNewOrgAdminMock.mockResolvedValue({ success: true });
    getEffectivePolicyMock.mockResolvedValue(72);
  });

  it("acceptAdminTransfer triggers onboarding reset after successful transfer", async () => {
    requireAuthenticatedMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "user-new-admin", globalRole: "user" },
    });

    createAdminClientMock.mockReturnValue(
      fakeAdminClient({
        transferForAccept: {
          id: "req-1",
          organization_id: "org-1",
          from_user_id: "user-old-admin",
          to_user_id: "user-new-admin",
          status: "pending",
        },
      })
    );

    const result = await acceptAdminTransfer("req-1");

    expect(result.success).toBe(true);
    expect(resetOnboardingForNewOrgAdminMock).toHaveBeenCalledWith(
      "org-1",
      "user-new-admin",
      "org_admin_changed"
    );
  });

  it("adminTransferTimeoutCheck triggers onboarding reset for auto-approved transfer", async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdminClient({
        expiredTransfers: [
          {
            id: "req-timeout-1",
            organization_id: "org-timeout-1",
            from_user_id: "user-old-admin",
            to_user_id: "user-new-admin",
            status: "pending",
          },
        ],
      })
    );

    const result = await adminTransferTimeoutCheck();

    expect(result.processed).toBe(1);
    expect(result.auto_approved).toBe(1);
    expect(result.errors).toEqual([]);
    expect(resetOnboardingForNewOrgAdminMock).toHaveBeenCalledWith(
      "org-timeout-1",
      "user-new-admin",
      "org_admin_changed"
    );
  });
});
