import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthenticatedMock,
  canManageOrganizationMock,
  isGlobalAdminMock,
  createAdminClientMock,
  inviteOrgUserMock,
  ensureKnownPersonMock,
  ensurePersonForUserMock,
  logAuditEventSafeMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  canManageOrganizationMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  inviteOrgUserMock: vi.fn(),
  ensureKnownPersonMock: vi.fn(),
  ensurePersonForUserMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  requireAdmin: vi.fn(),
  requireConferenceOpsAccess: vi.fn(),
  canManageOrganization: canManageOrganizationMock,
  isGlobalAdmin: isGlobalAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/actions/user-management", () => ({
  inviteOrgUser: inviteOrgUserMock,
}));

vi.mock("@/lib/identity/lifecycle", () => ({
  ensureKnownPerson: ensureKnownPersonMock,
  ensurePersonForUser: ensurePersonForUserMock,
}));

vi.mock("@/lib/actions/conference-legal", () => ({
  getMyConferenceLegalGate: vi.fn(),
  getPersonAssigneeLegalGate: vi.fn(),
}));

vi.mock("@/lib/actions/conference-commerce", () => ({
  calculateConferenceRefund: vi.fn(),
  requestConferenceRefund: vi.fn(),
}));

vi.mock("@/lib/actions/conference-badges", () => ({
  requestBadgeReprint: vi.fn(),
}));

vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: logAuditEventSafeMock,
}));

import { resolveAssigneeForEmail } from "../conference-people";

function fakeContactsClient(contact: { name: string | null; role_title: string | null } | null = null) {
  return {
    from: (table: string) => {
      if (table === "contacts") {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: contact, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("resolveAssigneeForEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invites a new email and parks the assignment as pending_user_activation", async () => {
    inviteOrgUserMock.mockResolvedValue({ success: true });
    createAdminClientMock.mockReturnValue(fakeContactsClient());
    ensureKnownPersonMock.mockResolvedValue({ personId: "canon-1" });

    const result = await resolveAssigneeForEmail({ organizationId: "org-1", targetEmail: "new@store.com" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data).toEqual({
      targetUserId: null,
      assignmentStatus: "pending_user_activation",
      normalizedEmail: "new@store.com",
      canonicalPersonId: "canon-1",
    });
    expect(inviteOrgUserMock).toHaveBeenCalledWith("org-1", "new@store.com", "member");
    expect(ensurePersonForUserMock).not.toHaveBeenCalled();
  });

  it("resolves a known userId immediately as assigned, skipping the invite", async () => {
    ensurePersonForUserMock.mockResolvedValue({ personId: "canon-2" });

    const result = await resolveAssigneeForEmail({ organizationId: "org-1", targetUserId: "user-1" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data).toEqual({
      targetUserId: "user-1",
      assignmentStatus: "assigned",
      normalizedEmail: null,
      canonicalPersonId: "canon-2",
    });
    expect(inviteOrgUserMock).not.toHaveBeenCalled();
  });

  it("propagates an inviteOrgUser failure without resolving a canonical person", async () => {
    inviteOrgUserMock.mockResolvedValue({ success: false, error: "invite failed" });

    const result = await resolveAssigneeForEmail({ organizationId: "org-1", targetEmail: "broken@store.com" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBe("invite failed");
    expect(ensureKnownPersonMock).not.toHaveBeenCalled();
  });
});

