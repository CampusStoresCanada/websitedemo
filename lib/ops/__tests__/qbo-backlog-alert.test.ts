// The QuickBooks backlog alert rule.
//
// The failure this guards: on 2026-09-01 a misc-receipt row died holding
// $4,689.50 of collected money. Its alert was event-raised at failure time, a
// human resolved it on 2026-09-03 while the row was still `failed`, and
// nothing ever spoke again — event-raised alerts are never re-evaluated, and a
// terminally-failed row never fails a second time. The money stayed unposted
// and unflagged for a week.
//
// So this rule has to (a) see all five queues, not just invoice export, and
// (b) keep firing while a row is still failed, regardless of what anyone did
// to the alert. It must also stay quiet about rows a human deliberately closed
// without posting, or it becomes an alert people learn to ignore.

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Per-table counts of rows matching whatever status the rule asks for. */
let failedByTable: Record<string, number> = {};
let statusesAskedFor: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: async (_column: string, value: unknown) => {
          statusesAskedFor.push(String(value));
          return { data: null, count: failedByTable[table] ?? 0, error: null };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: vi.fn(async () => undefined),
}));

const ALL_QUEUES = [
  "qbo_export_queue",
  "qbo_membership_refund_queue",
  "qbo_conference_receipt_queue",
  "qbo_conference_refund_queue",
  "qbo_misc_receipt_queue",
];

async function runRule() {
  const { evaluateQBExportBacklog } = await import("../alerts");
  return evaluateQBExportBacklog();
}

describe("qbo_export_backlog rule", () => {
  beforeEach(() => {
    failedByTable = {};
    statusesAskedFor = [];
    vi.resetModules();
  });

  it("counts only rows a human has not deliberately closed", async () => {
    // Whatever else changes, the rule must never count `skipped` rows — that is
    // the state that lets a legitimately-parked row stop nagging, and an alert
    // nobody can legitimately clear is one people stop reading.
    failedByTable = { qbo_misc_receipt_queue: 1 };
    await runRule();
    expect(new Set(statusesAskedFor)).toEqual(new Set(["failed"]));
  });

  it("looks at every queue, not just invoice export", async () => {
    await runRule();
    expect(statusesAskedFor).toHaveLength(ALL_QUEUES.length);
  });

  it("stays silent when nothing is failed", async () => {
    await expect(runRule()).resolves.toBeNull();
  });

  it("fires on a lone misc-receipt row — the JVCKENWOOD case", async () => {
    failedByTable = { qbo_misc_receipt_queue: 1 };
    const alert = (await runRule()) as {
      ruleKey: string;
      message: string;
      details: { failedCount: number; byQueue: Record<string, number> };
    } | null;

    expect(alert?.ruleKey).toBe("qbo_export_backlog");
    expect(alert?.details.failedCount).toBe(1);
    expect(alert?.details.byQueue).toEqual({ "misc receipt": 1 });
    // The message is frozen at creation, so the breakdown has to be inside it.
    expect(alert?.message).toContain("1 misc receipt");
  });

  it("names each queue separately — they need different people looking", async () => {
    failedByTable = { qbo_misc_receipt_queue: 2, qbo_export_queue: 1 };
    const alert = (await runRule()) as {
      severity: string;
      message: string;
      details: { failedCount: number; byQueue: Record<string, number> };
    } | null;

    expect(alert?.details.failedCount).toBe(3);
    expect(alert?.details.byQueue).toEqual({ "invoice export": 1, "misc receipt": 2 });
    expect(alert?.severity).toBe("critical");
    expect(alert?.message).toContain("1 invoice export");
    expect(alert?.message).toContain("2 misc receipt");
  });
});
