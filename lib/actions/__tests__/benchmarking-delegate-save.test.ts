import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The colleague an org_admin delegates a submission to must be able to answer
 * the questions and submit. The list actions (locations, categories, …) always
 * allowed them; the plain-field guard did not, so a delegate could build their
 * lists and then watch every other answer fail to save.
 */

const ORG = "org-1";
const DELEGATE = "user-delegate";
const BYSTANDER = "user-bystander";
const ROW_ID = "bm-1";

const state = vi.hoisted(() => ({
  userId: "",
  orgAdminOrgIds: [] as string[],
  globalRole: null as string | null,
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({
    ok: true,
    ctx: {
      userId: state.userId,
      globalRole: state.globalRole,
      orgAdminOrgIds: state.orgAdminOrgIds,
      supabase: {},
    },
  }),
  isGlobalAdmin: (role: string | null) => role === "admin" || role === "super_admin",
  canManageOrganization: (
    ctx: { globalRole: string | null; orgAdminOrgIds: string[] },
    orgId: string,
  ) =>
    ctx.globalRole === "admin" ||
    ctx.globalRole === "super_admin" ||
    ctx.orgAdminOrgIds.includes(orgId),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.row, error: null }),
          single: async () => ({ data: state.row, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { saveBenchmarkingField } from "../benchmarking-survey";

beforeEach(() => {
  state.orgAdminOrgIds = [];
  state.globalRole = null;
  state.updates = [];
  state.row = {
    id: ROW_ID,
    organization_id: ORG,
    status: "draft",
    respondent_delegate_profile_id: DELEGATE,
  };
});

describe("saveBenchmarkingField permissions", () => {
  it("saves for the delegated respondent who is not an org admin", async () => {
    state.userId = DELEGATE;
    const result = await saveBenchmarkingField(ROW_ID, "store_name", "Campus Store");
    expect(result).toEqual({ success: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].store_name).toBe("Campus Store");
  });

  it("saves for the store's org admin", async () => {
    state.userId = "user-admin";
    state.orgAdminOrgIds = [ORG];
    const result = await saveBenchmarkingField(ROW_ID, "store_name", "Campus Store");
    expect(result.success).toBe(true);
  });

  it("refuses a colleague who is neither admin nor delegate", async () => {
    state.userId = BYSTANDER;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await saveBenchmarkingField(ROW_ID, "store_name", "Campus Store");
    expect(result.success).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses the delegate once the survey is submitted", async () => {
    state.userId = DELEGATE;
    state.row = { ...state.row, status: "submitted" };
    const result = await saveBenchmarkingField(ROW_ID, "store_name", "Campus Store");
    expect(result.success).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});
