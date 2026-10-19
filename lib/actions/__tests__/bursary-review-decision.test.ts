import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Recording a decision on a travel-bursary application.
 *
 * These are registrations of interest, not scored applications — qualification
 * is the board's call. So the only thing this path may change is the status,
 * and the only thing worth pinning is that it changes it for the right person,
 * to a value the database will accept, and leaves a record of who did it.
 *
 * ⚠️ The four statuses are exactly what
 * `conference_bursary_applications_status_check` allows (verified against the
 * live constraint 2026-10-19). A fifth value added in TypeScript without
 * widening that constraint writes a status the database rejects, which is why
 * the action validates rather than trusting its own parameter type.
 */

const { requireAdminMock, createAdminClientMock, auditMock, revalidateMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  auditMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: requireAdminMock,
  requireAuthenticated: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: auditMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { setBursaryApplicationStatus } from "../conference-bursary";

const APP_ID = "app-1";

interface Captured {
  update?: Record<string, unknown>;
  updateCalls: number;
}

function mockDb(existing: { status: string; conference_id: string; organization_id: string } | null) {
  const captured: Captured = { updateCalls: 0 };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        captured.update = payload;
        captured.updateCalls += 1;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  };
  createAdminClientMock.mockReturnValue(client);
  return captured;
}

const row = { status: "submitted", conference_id: "conf-27", organization_id: "org-9" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, ctx: { userId: "staff-1", globalRole: "admin" } });
});

describe("recording a bursary decision", () => {
  it("writes the status an admin picked", async () => {
    const db = mockDb(row);

    const result = await setBursaryApplicationStatus({ applicationId: APP_ID, status: "approved" });

    expect(result.success).toBe(true);
    expect(db.update?.status).toBe("approved");
    // updated_at moves with it, so "when was this decided" is answerable.
    expect(typeof db.update?.updated_at).toBe("string");
  });

  it("records the transition, not just the destination", async () => {
    mockDb(row);

    await setBursaryApplicationStatus({ applicationId: APP_ID, status: "denied" });

    expect(auditMock).toHaveBeenCalledTimes(1);
    const event = auditMock.mock.calls[0][0];
    expect(event.action).toBe("bursary_application_status_changed");
    expect(event.entityId).toBe(APP_ID);
    expect(event.actorId).toBe("staff-1");
    expect(event.details.from).toBe("submitted");
    expect(event.details.to).toBe("denied");
    expect(event.details.organizationId).toBe("org-9");
  });

  it("refuses anyone who is not an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: "Admin access required" });
    const db = mockDb(row);

    const result = await setBursaryApplicationStatus({ applicationId: APP_ID, status: "approved" });

    expect(result.success).toBe(false);
    expect(db.updateCalls).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("refuses a status the check constraint would reject", async () => {
    const db = mockDb(row);

    const result = await setBursaryApplicationStatus({
      applicationId: APP_ID,
      // Past the compiler on purpose: the guard exists for values that arrive
      // at runtime from a client, where the type annotation proves nothing.
      status: "shortlisted" as never,
    });

    expect(result.success).toBe(false);
    expect(db.updateCalls).toBe(0);
  });

  it("does nothing when the status is already what was picked", async () => {
    const db = mockDb({ ...row, status: "approved" });

    const result = await setBursaryApplicationStatus({ applicationId: APP_ID, status: "approved" });

    // Succeeds, but writes neither a row nor an audit entry — re-picking the
    // current value in the dropdown is not a decision to record.
    expect(result.success).toBe(true);
    expect(db.updateCalls).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("reports a missing application rather than writing blindly", async () => {
    const db = mockDb(null);

    const result = await setBursaryApplicationStatus({ applicationId: APP_ID, status: "approved" });

    expect(result.success).toBe(false);
    expect(db.updateCalls).toBe(0);
  });
});
