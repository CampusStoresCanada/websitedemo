// Queue-level failure policy: which failures get a long ladder, which keep the
// short one, and when a row is declared terminally failed.
//
// The bug these pin down: a transient Intuit fault and a permanent
// misconfiguration used to draw on the same three-attempt budget, so a gateway
// blip killed a $5,198 receipt in 48 minutes while looking exactly like a real
// config error.

import { describe, it, expect, vi } from "vitest";
import {
  failQueueRow,
  isRetryableFailure,
  describeFailure,
  adoptExistingReceipt,
  startRunBudget,
  releaseUnprocessedRows,
} from "../queue";
import { QBApiError } from "../client";

/** Captures the .update() payload each queue write would send. */
function captureDb() {
  const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          writes.push({ table, payload });
          return {
            eq: vi.fn(async () => ({ error: null })),
            in: vi.fn(async () => ({ error: null })),
          };
        },
      };
    },
  };
  return { db: db as never, writes };
}

const transient = (status = 504) =>
  new QBApiError({
    message: `QB API GET /query failed (${status}): stream timeout`,
    status,
    retryable: true,
    attempts: 3,
  });

const terminal = () => new Error('"Booth 716" has no QuickBooks item mapped');

describe("isRetryableFailure", () => {
  it("trusts only a QBApiError that says so", () => {
    expect(isRetryableFailure(transient())).toBe(true);
    expect(
      isRetryableFailure(
        new QBApiError({ message: "bad request", status: 400, retryable: false, attempts: 1 })
      )
    ).toBe(false);
  });

  it("treats an unclassified error as not-known-retryable", () => {
    expect(isRetryableFailure(terminal())).toBe(false);
    expect(isRetryableFailure("a string")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("marks a transport fault so an operator can tell Intuit's fault from ours", () => {
    expect(describeFailure(transient())).toMatch(/^\[transient after 3 in-call attempts\]/);
  });

  it("leaves our own errors exactly as thrown", () => {
    expect(describeFailure(terminal())).toBe('"Booth 716" has no QuickBooks item mapped');
  });
});

describe("failQueueRow", () => {
  it("gives a transient fault a ladder that outlives a real Intuit incident", async () => {
    const { db, writes } = captureDb();

    const outcome = await failQueueRow(
      db,
      "qbo_misc_receipt_queue",
      { id: "row-1", retry_count: 2, max_retries: 3 },
      transient()
    );

    // Under the old policy retry_count 2 of max 3 was the last attempt and this
    // row would have died here. That is the regression these guard.
    expect(outcome.exhausted).toBe(false);
    expect(outcome.retryable).toBe(true);
    expect(writes[0].payload.status).toBe("retrying");
    expect(writes[0].payload.next_retry_at).not.toBeNull();
  });

  it("walks the retryable ladder rather than repeating one delay", async () => {
    const delays: number[] = [];
    for (const retryCount of [0, 1, 2, 3, 4]) {
      const { db, writes } = captureDb();
      await failQueueRow(
        db,
        "qbo_misc_receipt_queue",
        { id: "row", retry_count: retryCount, max_retries: 3 },
        transient()
      );
      const next = new Date(String(writes[0].payload.next_retry_at)).getTime();
      delays.push(Math.round((next - Date.now()) / 60000));
    }
    expect(delays).toEqual([5, 20, 60, 240, 720]);
  });

  it("eventually stops, so a genuinely broken integration still raises an alert", async () => {
    const { db, writes } = captureDb();

    const outcome = await failQueueRow(
      db,
      "qbo_misc_receipt_queue",
      { id: "row", retry_count: 6, max_retries: 3 },
      transient()
    );

    expect(outcome.exhausted).toBe(true);
    expect(writes[0].payload.status).toBe("failed");
    expect(writes[0].payload.next_retry_at).toBeNull();
  });

  it("keeps the original short budget for failures it cannot classify", async () => {
    const { db, writes } = captureDb();

    const outcome = await failQueueRow(
      db,
      "qbo_export_queue",
      { id: "row", retry_count: 2, max_retries: 3 },
      terminal()
    );

    expect(outcome.exhausted).toBe(true);
    expect(writes[0].payload.status).toBe("failed");
    expect(writes[0].payload.error_message).toBe(
      '"Booth 716" has no QuickBooks item mapped'
    );
  });

  it("writes to whichever queue it was given", async () => {
    const { db, writes } = captureDb();
    await failQueueRow(
      db,
      "qbo_conference_refund_queue",
      { id: "row", retry_count: 0, max_retries: 3 },
      terminal()
    );
    expect(writes[0].table).toBe("qbo_conference_refund_queue");
  });
});

describe("adoptExistingReceipt", () => {
  it("records the found document in each queue's own id column", async () => {
    const cases = [
      ["qbo_export_queue", "qbo_invoice_id"],
      ["qbo_misc_receipt_queue", "qbo_sales_receipt_id"],
      ["qbo_conference_receipt_queue", "qbo_sales_receipt_id"],
      ["qbo_conference_refund_queue", "qbo_refund_receipt_id"],
      ["qbo_membership_refund_queue", "qbo_refund_receipt_id"],
    ] as const;

    for (const [table, column] of cases) {
      const { db, writes } = captureDb();
      await adoptExistingReceipt(db, table, "row", "1162");
      expect(writes[0].payload.status).toBe("completed");
      expect(writes[0].payload[column]).toBe("1162");
      expect(writes[0].payload.error_message).toBeNull();
    }
  });
});

describe("run budget", () => {
  it("reports spent only once the window has passed", async () => {
    const isOut = startRunBudget(0);
    expect(isOut()).toBe(true);
    expect(startRunBudget(60_000)()).toBe(false);
  });

  it("hands unprocessed rows straight back, not into a ten-minute stale wait", async () => {
    const { db, writes } = captureDb();
    await releaseUnprocessedRows(db, "qbo_misc_receipt_queue", ["a", "b"]);
    expect(writes[0].payload.status).toBe("retrying");
    expect(writes[0].payload.lease_expires_at).toBeNull();
  });

  it("does nothing when there is nothing left over", async () => {
    const { db, writes } = captureDb();
    await releaseUnprocessedRows(db, "qbo_misc_receipt_queue", []);
    expect(writes).toHaveLength(0);
  });
});
