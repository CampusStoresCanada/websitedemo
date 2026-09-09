// Shared failure policy for every QBO worker queue.
//
// There are five of these queues and, before this file, five character-identical
// `fail*Row` functions — same [5, 20, 60] ladder, same `max_retries` of 3,
// differing only in the table name. That meant the retry policy had to be got
// right five times, and on 2026-09-01 it was wrong in all five at once: a
// transient Intuit 504 and a permanent misconfiguration ("no QuickBooks item
// mapped") drew on the same three-attempt budget, so a gateway blip terminally
// killed a $5,198 sales receipt in 48 minutes.
//
// The fix is to let the failure say what kind it is. QBApiError already knows
// whether a retry could ever help; this file turns that verdict into a backoff.
//
//   retryable (gateway/network/rate-limit) → a ladder that outlives a real
//     Intuit incident, ~40 hours across 7 attempts. Intuit's bad days are
//     measured in hours, so anything shorter is a coin flip.
//
//   everything else → exactly today's behaviour, unchanged: the row's own
//     `max_retries` over [5, 20, 60]. Deliberately NOT shortened to fail fast.
//     Most non-QBApiError failures are Supabase reads and mapping errors, and
//     some of those are themselves transient; collapsing them to a single
//     attempt would trade one silent-loss bug for another.

import type { createAdminClient } from "@/lib/supabase/admin";
import { QBApiError } from "./client";

type Db = ReturnType<typeof createAdminClient>;

/** The five worker queues. All share one row shape (id, status, retry_count,
 *  max_retries, next_retry_at, lease_expires_at, error_message, processed_at)
 *  and differ only in which document id they write back on success. */
export const QB_QUEUE_TABLES = [
  "qbo_export_queue",
  "qbo_membership_refund_queue",
  "qbo_conference_receipt_queue",
  "qbo_conference_refund_queue",
  "qbo_misc_receipt_queue",
] as const;

export type QBQueueTable = (typeof QB_QUEUE_TABLES)[number];

export interface QBQueueRowLike {
  id: string;
  retry_count: number;
  max_retries: number;
}

/** ~40 hours in total. Long enough that a multi-hour Intuit incident becomes a
 *  delay rather than a permanent loss, and still bounded so a genuinely broken
 *  integration stops eventually and raises an alert. */
const RETRYABLE_BACKOFF_MINUTES = [5, 20, 60, 240, 720, 1440];
const RETRYABLE_MAX_ATTEMPTS = RETRYABLE_BACKOFF_MINUTES.length + 1; // 7

/** Today's ladder, preserved for failures we cannot classify. */
const DEFAULT_BACKOFF_MINUTES = [5, 20, 60];

/**
 * Is this worth trying again?
 *
 * Only a QBApiError can answer affirmatively — it is the one failure that
 * carries a transport verdict. Everything else (a missing invoice, an
 * unmapped item, a Supabase hiccup) is treated as unclassified and keeps the
 * conservative legacy budget.
 */
export function isRetryableFailure(err: unknown): boolean {
  return err instanceof QBApiError && err.retryable;
}

/** What the queue row's `error_message` should say. Prefixed for retryable
 *  transport faults so an operator reading the failed panel can tell "Intuit
 *  was down" from "we have a bug" without opening the code. */
export function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof QBApiError && err.retryable) {
    return `[transient after ${err.attempts} in-call attempt${
      err.attempts === 1 ? "" : "s"
    }] ${message}`;
  }
  return message;
}

export interface QueueFailureOutcome {
  /** True when this attempt used the last of the row's budget — the caller's
   *  cue to raise its own alert. Alert text stays with the caller because each
   *  queue names a different subject (invoice, conference order, payment). */
  exhausted: boolean;
  retryable: boolean;
  /** Exactly what was written to `error_message`. */
  message: string;
}

/**
 * Record a failed attempt on any QBO queue row, choosing the backoff from the
 * failure's own kind. Replaces the five copies of this logic.
 *
 * Note the retryable branch deliberately ignores the row's `max_retries`
 * column: that column defaults to 3 across all five tables and widening the
 * budget for transport faults would otherwise need a migration on each. The
 * claim query keys on `status` and `next_retry_at` only, never `max_retries`,
 * so a higher retry_count is safe.
 */
export async function failQueueRow(
  db: Db,
  table: QBQueueTable,
  row: QBQueueRowLike,
  err: unknown
): Promise<QueueFailureOutcome> {
  const retryable = isRetryableFailure(err);
  const message = describeFailure(err);
  const newRetryCount = row.retry_count + 1;

  const ladder = retryable ? RETRYABLE_BACKOFF_MINUTES : DEFAULT_BACKOFF_MINUTES;
  const maxAttempts = retryable ? RETRYABLE_MAX_ATTEMPTS : row.max_retries;
  const exhausted = newRetryCount >= maxAttempts;

  const backoffMinutes = ladder[Math.min(row.retry_count, ladder.length - 1)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from(table)
    .update({
      status: exhausted ? "failed" : "retrying",
      retry_count: newRetryCount,
      next_retry_at: exhausted ? null : nextRetry,
      error_message: message,
      lease_expires_at: null,
    })
    .eq("id", row.id);

  return { exhausted, retryable, message };
}

// ─────────────────────────────────────────────────────────────────
// Idempotent completion
// ─────────────────────────────────────────────────────────────────

/** Which column each queue writes its resulting QBO document id into. */
const RESULT_ID_COLUMN: Record<QBQueueTable, string> = {
  qbo_export_queue: "qbo_invoice_id",
  qbo_membership_refund_queue: "qbo_refund_receipt_id",
  qbo_conference_receipt_queue: "qbo_sales_receipt_id",
  qbo_conference_refund_queue: "qbo_refund_receipt_id",
  qbo_misc_receipt_queue: "qbo_sales_receipt_id",
};

/**
 * Close a row against a document QBO already holds, instead of posting a
 * second one.
 *
 * Reached two ways: the row already stored the id (a retry after a clean
 * success), or the DocNumber pre-flight found the document the row never got
 * to record. Either way the correct outcome is the same — adopt it, complete
 * the row, and leave the books alone.
 */
export async function adoptExistingReceipt(
  db: Db,
  table: QBQueueTable,
  rowId: string,
  documentId: string
): Promise<void> {
  await db
    .from(table)
    .update({
      status: "completed",
      [RESULT_ID_COLUMN[table]]: documentId,
      processed_at: new Date().toISOString(),
      lease_expires_at: null,
      error_message: null,
    })
    .eq("id", rowId);
}

// ─────────────────────────────────────────────────────────────────
// Lease budget
// ─────────────────────────────────────────────────────────────────

/**
 * How long a worker may keep processing before it stops starting new rows.
 *
 * Retrying inside qbRequest costs wall-clock (up to ~31.6s per call, and a
 * single row makes several), and the three conference workers run
 * concurrently under a 5-minute lease. Without a budget, a slow Intuit day
 * would let a run overrun its own lease — another worker would then reclaim
 * rows still being processed and post them twice.
 *
 * Set under LEASE_DURATION_MS with room for the in-flight row to finish.
 * Rows left unclaimed simply wait for the next cron tick (every 15 minutes).
 */
export const RUN_BUDGET_MS = 3 * 60 * 1000;

/** Returns a function that reports whether the run's budget is spent. */
export function startRunBudget(budgetMs: number = RUN_BUDGET_MS): () => boolean {
  const endsAt = Date.now() + budgetMs;
  return () => Date.now() >= endsAt;
}

/**
 * Hand rows back that a run claimed but ran out of budget to process.
 *
 * Without this they would sit in `processing` until the stale-lease sweep
 * reclaims them ten minutes later — needlessly delaying money that could go
 * out on the next tick.
 */
export async function releaseUnprocessedRows(
  db: Db,
  table: QBQueueTable,
  rowIds: string[]
): Promise<void> {
  if (rowIds.length === 0) return;
  await db
    .from(table)
    .update({
      status: "retrying",
      lease_expires_at: null,
      next_retry_at: new Date().toISOString(),
    })
    .in("id", rowIds);
}
