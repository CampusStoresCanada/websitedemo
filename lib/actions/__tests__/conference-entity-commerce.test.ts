import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthenticatedMock,
  canManageOrganizationMock,
  isGlobalAdminMock,
  createAdminClientMock,
  resolveAssigneeForEmailMock,
  logAuditEventSafeMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  canManageOrganizationMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  resolveAssigneeForEmailMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  requireAdmin: vi.fn(),
  canManageOrganization: canManageOrganizationMock,
  isGlobalAdmin: isGlobalAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/actions/conference-people", () => ({
  resolveAssigneeForEmail: resolveAssigneeForEmailMock,
}));

vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: logAuditEventSafeMock,
}));

import { addConferenceAttendee, removeConferenceAttendee } from "../conference-entity-commerce";

const AUTH_OK = { ok: true, ctx: { userId: "admin-1", globalRole: "org_admin", activeOrgIds: ["org-1"] } };

function fakeClientForAdd(opts: { insertedId?: string; insertError?: string; existingUsers?: Array<{ id: string; email: string }> } = {}) {
  const insertSpy = vi.fn();
  return {
    spy: { insertSpy },
    client: {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: opts.existingUsers ?? [] }, error: null }),
        },
      },
      from: (table: string) => {
        if (table === "conference_people") {
          return {
            insert: (row: Record<string, unknown>) => {
              insertSpy(row);
              return {
                select: () => ({
                  single: async () =>
                    opts.insertError
                      ? { data: null, error: { message: opts.insertError } }
                      : { data: { id: opts.insertedId ?? "person-1" }, error: null },
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

function fakeClientForRemove(opts: { sourceType?: string; organizationId?: string | null }) {
  const deleteSpy = vi.fn();
  const seatUpdateSpy = vi.fn();
  return {
    spy: { deleteSpy, seatUpdateSpy },
    client: {
      from: (table: string) => {
        if (table === "conference_people") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { organization_id: opts.organizationId ?? "org-1", source_type: opts.sourceType ?? "manual" },
                  error: null,
                }),
              }),
            }),
            delete: () => ({
              eq: (_col: string, id: string) => {
                deleteSpy(id);
                return { error: null };
              },
            }),
          };
        }
        if (table === "entity_balance_seats") {
          return {
            update: (values: Record<string, unknown>) => ({
              eq: (_col: string, id: string) => {
                seatUpdateSpy(values, id);
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

describe("conference-entity-commerce attendees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedMock.mockResolvedValue(AUTH_OK);
    canManageOrganizationMock.mockReturnValue(true);
    isGlobalAdminMock.mockReturnValue(false);
  });

  it("adds a no-email walk-in as assigned, with no invite resolution", async () => {
    const fake = fakeClientForAdd({ insertedId: "person-1" });
    createAdminClientMock.mockReturnValue(fake.client);

    const result = await addConferenceAttendee("conf-1", "org-1", {
      displayName: "Jane Smith",
      contactEmail: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data).toEqual({ id: "person-1", assignmentStatus: "assigned", invited: false });
    expect(resolveAssigneeForEmailMock).not.toHaveBeenCalled();
    expect(fake.spy.insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "manual",
        person_kind: "unassigned",
        display_name: "Jane Smith",
        contact_email: null,
        user_id: null,
        assignment_status: "assigned",
        assigned_email_snapshot: null,
      })
    );
  });

  it("links immediately when the email matches an existing platform user", async () => {
    const fake = fakeClientForAdd({
      insertedId: "person-2",
      existingUsers: [{ id: "user-42", email: "jane@store.com" }],
    });
    createAdminClientMock.mockReturnValue(fake.client);
    resolveAssigneeForEmailMock.mockResolvedValue({
      success: true,
      data: { targetUserId: "user-42", assignmentStatus: "assigned", normalizedEmail: "jane@store.com", canonicalPersonId: "canon-1" },
    });

    const result = await addConferenceAttendee("conf-1", "org-1", {
      displayName: "Jane Smith",
      contactEmail: "jane@store.com",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.invited).toBe(false);
    expect(resolveAssigneeForEmailMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      targetUserId: "user-42",
      targetEmail: "jane@store.com",
    });
    expect(fake.spy.insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-42", assignment_status: "assigned", assigned_email_snapshot: null })
    );
  });

  it("invites a new email and parks the row as pending_user_activation", async () => {
    const fake = fakeClientForAdd({ insertedId: "person-3", existingUsers: [] });
    createAdminClientMock.mockReturnValue(fake.client);
    resolveAssigneeForEmailMock.mockResolvedValue({
      success: true,
      data: {
        targetUserId: null,
        assignmentStatus: "pending_user_activation",
        normalizedEmail: "new@store.com",
        canonicalPersonId: "canon-2",
      },
    });

    const result = await addConferenceAttendee("conf-1", "org-1", {
      displayName: "New Person",
      contactEmail: "new@store.com",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data).toEqual({ id: "person-3", assignmentStatus: "pending_user_activation", invited: true });
    expect(fake.spy.insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
        canonical_person_id: "canon-2",
        assignment_status: "pending_user_activation",
        assigned_email_snapshot: "new@store.com",
      })
    );
  });

  it("propagates a resolveAssigneeForEmail failure without inserting a row", async () => {
    const fake = fakeClientForAdd({ existingUsers: [] });
    createAdminClientMock.mockReturnValue(fake.client);
    resolveAssigneeForEmailMock.mockResolvedValue({ success: false, error: "invite failed" });

    const result = await addConferenceAttendee("conf-1", "org-1", {
      displayName: "New Person",
      contactEmail: "broken@store.com",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBe("invite failed");
    expect(fake.spy.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects addConferenceAttendee for a caller without org-management permission", async () => {
    canManageOrganizationMock.mockReturnValue(false);
    isGlobalAdminMock.mockReturnValue(false);
    const fake = fakeClientForAdd();
    createAdminClientMock.mockReturnValue(fake.client);

    const result = await addConferenceAttendee("conf-1", "org-1", {
      displayName: "Nope",
      contactEmail: null,
    });

    expect(result.success).toBe(false);
    expect(fake.spy.insertSpy).not.toHaveBeenCalled();
  });

  it("removeConferenceAttendee frees seats and deletes a manual-source row", async () => {
    const fake = fakeClientForRemove({ sourceType: "manual" });
    createAdminClientMock.mockReturnValue(fake.client);

    const result = await removeConferenceAttendee("person-1");

    expect(result.success).toBe(true);
    expect(fake.spy.seatUpdateSpy).toHaveBeenCalledWith({ holder_person_id: null }, "person-1");
    expect(fake.spy.deleteSpy).toHaveBeenCalledWith("person-1");
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conference_attendee_removed", entityId: "person-1" })
    );
  });

  it("removeConferenceAttendee rejects rows that aren't source_type 'manual'", async () => {
    const fake = fakeClientForRemove({ sourceType: "registration" });
    createAdminClientMock.mockReturnValue(fake.client);

    const result = await removeConferenceAttendee("person-1");

    expect(result.success).toBe(false);
    expect(fake.spy.deleteSpy).not.toHaveBeenCalled();
    expect(logAuditEventSafeMock).not.toHaveBeenCalled();
  });
});
