import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthenticatedMock,
  requireAdminMock,
  isGlobalAdminMock,
  createAdminClientMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  requireAdminMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  requireAdmin: requireAdminMock,
  isGlobalAdmin: isGlobalAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  checkLegalAcceptance,
  getLegalAcceptanceStats,
  updateLegalVersion,
} from "../conference-legal";

function fakeClientForAcceptanceCheck() {
  return {
    from: (table: string) => {
      if (table === "conference_legal_versions") {
        const secondOrder = {
          order: () => ({
            data: [
              { id: "v-terms-2", document_type: "terms_and_conditions" },
              { id: "v-terms-1", document_type: "terms_and_conditions" },
              { id: "v-coc-1", document_type: "code_of_conduct" },
            ],
            error: null,
          }),
        };
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: () => secondOrder,
              }),
            }),
          }),
        };
      }
      if (table === "legal_acceptances") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                data: [{ legal_version_id: "v-terms-2" }],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function fakeClientForStats() {
  return {
    from: (table: string) => {
      if (table === "conference_legal_versions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({
                data: { id: "v-terms-2", conference_id: "conf-1" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "conference_registrations") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "legal_acceptances") {
        return {
          select: () => ({
            eq: () => ({
              data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "outsider" }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function fakeClientForUpdate(status: string, updateSpy?: () => void) {
  const updatedRow = {
    id: "v1",
    conference_id: "conf-1",
    document_type: "privacy_notice",
    version: 1,
    content: "<p>updated</p>",
    effective_at: "2027-01-01T00:00:00Z",
  };
  return {
    from: (table: string) => {
      if (table === "conference_legal_versions") {
        return {
          // read: .select("conference_id").eq("id", ...).maybeSingle()
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({ data: { conference_id: "conf-1" }, error: null }),
            }),
          }),
          // write: .update({...}).eq("id", ...).select().single()
          update: () => {
            updateSpy?.();
            return {
              eq: () => ({
                select: () => ({
                  single: () => ({ data: updatedRow, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === "conference_instances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({ data: { status }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("conference legal actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updateLegalVersion blocks in-place edits once the conference is on sale", async () => {
    requireAdminMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "admin-1", globalRole: "admin" },
    });
    const updateSpy = vi.fn();
    createAdminClientMock.mockReturnValue(fakeClientForUpdate("registration_open", updateSpy));

    const result = await updateLegalVersion("v1", {
      document_type: "privacy_notice",
      version: 1,
      content: "<p>updated</p>",
      effective_at: "2027-01-01T00:00:00Z",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/on sale/i);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updateLegalVersion allows in-place edits while the conference is a draft", async () => {
    requireAdminMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "admin-1", globalRole: "admin" },
    });
    const updateSpy = vi.fn();
    createAdminClientMock.mockReturnValue(fakeClientForUpdate("draft", updateSpy));

    const result = await updateLegalVersion("v1", {
      document_type: "privacy_notice",
      version: 1,
      content: "<p>updated</p>",
      effective_at: "2027-01-01T00:00:00Z",
    });

    expect(result.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.content).toBe("<p>updated</p>");
  });

  it("checkLegalAcceptance reports missing latest required document types", async () => {
    requireAuthenticatedMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "u1", globalRole: "user" },
    });
    isGlobalAdminMock.mockReturnValue(false);
    createAdminClientMock.mockReturnValue(fakeClientForAcceptanceCheck());

    const result = await checkLegalAcceptance("u1", "conf-1");

    expect(result.success).toBe(true);
    expect(result.data?.allAccepted).toBe(false);
    expect(result.data?.missing).toEqual(["code_of_conduct"]);
  });

  it("getLegalAcceptanceStats computes accepted/pending against required users", async () => {
    requireAdminMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "admin-1", globalRole: "admin" },
    });
    createAdminClientMock.mockReturnValue(fakeClientForStats());

    const result = await getLegalAcceptanceStats("v-terms-2");

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      total: 3,
      accepted: 2,
      pending: 1,
    });
  });
});
