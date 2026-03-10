import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminClientMock,
  getEffectivePolicyMock,
  getActivePolicySetMock,
  logAuditEventSafeMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getEffectivePolicyMock: vi.fn(),
  getActivePolicySetMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/policy/engine", () => ({
  getEffectivePolicy: getEffectivePolicyMock,
  getActivePolicySet: getActivePolicySetMock,
}));

vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: logAuditEventSafeMock,
}));

import { retentionPurgeRun } from "../jobs";

function fakeAdminClient(options: {
  conferences: Array<{ id: string; year: number; name: string; edition_code: string }>;
  rpcRowsByConferenceId?: Record<string, { records_purged: number; retention_job_id: string }>;
}) {
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    const conferenceId = String(args.p_conference_id);
    const row = options.rpcRowsByConferenceId?.[conferenceId] ?? {
      records_purged: 0,
      retention_job_id: `job-${conferenceId}`,
    };
    return { data: [row], error: null };
  });

  const from = vi.fn((table: string) => {
    if (table === "conference_instances") {
      return {
        select: () => ({
          order: () => ({
            data: options.conferences,
            error: null,
          }),
        }),
      };
    }
    if (table === "retention_jobs") {
      return {
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { id: "failed-job" }, error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in fake client: ${table}`);
  });

  return { rpc, from };
}

describe("retentionPurgeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs purge for due conferences and records summary", async () => {
    getEffectivePolicyMock.mockResolvedValue("march_1_conference_year_utc");
    getActivePolicySetMock.mockResolvedValue({ id: "policy-1" });

    const thisYear = new Date().getUTCFullYear();
    const client = fakeAdminClient({
      conferences: [
        { id: "conf-due", year: thisYear, name: "Due Conf", edition_code: "A" },
        { id: "conf-future", year: thisYear + 1, name: "Future Conf", edition_code: "B" },
      ],
      rpcRowsByConferenceId: {
        "conf-due": { records_purged: 3, retention_job_id: "ret-1" },
      },
    });
    createAdminClientMock.mockReturnValue(client);

    const result = await retentionPurgeRun();

    expect(result.success).toBe(true);
    expect(result.conferencesEvaluated).toBe(2);
    expect(result.conferencesDue).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.recordsPurged).toBe(3);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "retention_run_completed" })
    );
  });

  it("remains successful and records zero purges on idempotent rerun behavior", async () => {
    getEffectivePolicyMock.mockResolvedValue("march_1_conference_year_utc");
    getActivePolicySetMock.mockResolvedValue({ id: "policy-1" });

    const thisYear = new Date().getUTCFullYear();
    const client = fakeAdminClient({
      conferences: [{ id: "conf-due", year: thisYear, name: "Due Conf", edition_code: "A" }],
      rpcRowsByConferenceId: {
        "conf-due": { records_purged: 0, retention_job_id: "ret-2" },
      },
    });
    createAdminClientMock.mockReturnValue(client);

    const result = await retentionPurgeRun();

    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    expect(result.recordsPurged).toBe(0);
    expect(result.results[0]?.recordsPurged).toBe(0);
  });

  it("fails closed for unsupported retention rule", async () => {
    getEffectivePolicyMock.mockResolvedValue("unsupported_rule");
    getActivePolicySetMock.mockResolvedValue({ id: "policy-1" });
    createAdminClientMock.mockReturnValue(fakeAdminClient({ conferences: [] }));

    const result = await retentionPurgeRun();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported retention travel delete rule");
    expect(result.conferencesEvaluated).toBe(0);
  });
});
