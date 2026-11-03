import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An invoice can reach QuickBooks before it is paid (the CANCOLL invoice is
 * queued when it is issued). Its later paid event must re-open that row so the
 * worker posts the payment; before this, the insert hit the unique invoice_id,
 * was skipped as a duplicate, and the payment never reached QuickBooks.
 */

type Call = { op: string; args: unknown[] };
let calls: Call[] = [];
let insertError: { code: string } | null = null;

function chain(op: string) {
  const self: Record<string, unknown> = {};
  for (const name of ["eq", "is", "select", "single"]) {
    self[name] = (...args: unknown[]) => {
      calls.push({ op: `${op}.${name}`, args });
      return name === "single" ? Promise.resolve({ error: insertError }) : self;
    };
  }
  (self as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return self;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        calls.push({ op: "insert", args: [row] });
        return chain("insert");
      },
      update: (row: unknown) => {
        calls.push({ op: "update", args: [row] });
        return chain("update");
      },
    }),
  }),
}));

const { enqueueQBExport } = await import("../export");

beforeEach(() => {
  calls = [];
  insertError = null;
});

describe("enqueueQBExport", () => {
  it("queues a new invoice and touches nothing else", async () => {
    await enqueueQBExport("inv-1");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("re-opens a completed row with no payment when the invoice is queued again", async () => {
    insertError = { code: "23505" };
    await enqueueQBExport("inv-1");
    const update = calls.find((c) => c.op === "update");
    expect(update?.args[0]).toMatchObject({ status: "pending", retry_count: 0 });
    expect(calls).toContainEqual({ op: "update.eq", args: ["invoice_id", "inv-1"] });
    expect(calls).toContainEqual({ op: "update.eq", args: ["status", "completed"] });
    // A row that already has its payment is left alone.
    expect(calls).toContainEqual({ op: "update.is", args: ["qbo_payment_id", null] });
  });
});
