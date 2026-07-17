import { vi } from "vitest";

/**
 * Shared in-memory fake of the supabase-js client for unit tests.
 *
 * Each table gets a FIFO queue of results: every `.from(table)` call shifts the
 * next queued result and returns a chainable builder whose terminal awaits
 * resolve to it. RPCs resolve from `rpcResults` keyed by function name. Every
 * call is recorded for assertions.
 *
 * This replaces the three hand-rolled copies that previously lived in
 * webhook-processing / conference-checkout / conference-fulfillment tests.
 */

export type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

export type RecordedQuery = {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
};

export type RecordedRpc = { fn: string; args: unknown };

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "in",
  "gte",
  "lte",
  "gt",
  "lt",
  "or",
  "is",
  "not",
  "limit",
  "order",
  "range",
  "update",
  "delete",
  "insert",
  "upsert",
  "single",
  "maybeSingle",
] as const;

export type FakeDb = {
  db: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  recorded: RecordedQuery[];
  recordedRpcs: RecordedRpc[];
};

export function makeFakeDb(
  queues: Record<string, QueryResult[]> = {},
  rpcResults: Record<string, QueryResult> = {}
): FakeDb {
  const recorded: RecordedQuery[] = [];
  const recordedRpcs: RecordedRpc[] = [];

  const rpc = vi.fn((fn: string, args?: unknown) => {
    recordedRpcs.push({ fn, args });
    const result = rpcResults[fn] ?? { data: null, error: null };
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  });

  const from = vi.fn((table: string) => {
    const queue = queues[table] ?? [];
    const result = queue.length > 0 ? queue.shift()! : { data: null, error: null };
    const record: RecordedQuery = { table, calls: [] };
    recorded.push(record);

    const resolved = {
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    };

    const builder: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = vi.fn((...args: unknown[]) => {
        record.calls.push({ method, args });
        return builder;
      });
    }
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(resolve, reject);
    return builder;
  });

  return { db: { from, rpc }, from, rpc, recorded, recordedRpcs };
}

/** Convenience: flatten all recorded calls for one table. */
export function callsFor(recorded: RecordedQuery[], table: string) {
  return recorded.filter((entry) => entry.table === table).flatMap((entry) => entry.calls);
}
