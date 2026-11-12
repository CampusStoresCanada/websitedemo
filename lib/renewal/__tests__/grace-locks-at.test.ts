import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));

import { graceLocksAt } from "../jobs";

/**
 * Grace is "in, not yet paid". It runs grace_days, or until the dues invoice
 * the org owes falls due if that is later: Kivuto (2026-11) was admitted on
 * November 12 with dues due January 1, and the bare 30-day clock would have
 * locked them on December 12 for a bill not yet due.
 */

/** A db whose invoices query yields the given owed invoice (or none). */
function dbOwing(owed: { due_date: string } | null) {
  const filters: Array<[string, ...unknown[]]> = [];
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (...a: unknown[]) => (filters.push(["eq", ...a]), b),
    not: (...a: unknown[]) => (filters.push(["not", ...a]), b),
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data: owed, error: null }),
  });
  return {
    filters,
    db: { from: (table: string) => (table === "invoices" ? b : (() => { throw new Error(table); })()) },
  };
}

const START = new Date("2026-11-12T15:00:00Z");

describe("graceLocksAt", () => {
  it("runs the ordinary 30 days when nothing is owed", async () => {
    const { db } = dbOwing(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = await graceLocksAt(db as any, "org", START, 30);
    expect(at.toISOString()).toBe("2026-12-12T15:00:00.000Z");
  });

  it("holds until the day after an owed invoice falls due, when that is later", async () => {
    const { db } = dbOwing({ due_date: "2027-01-01" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = await graceLocksAt(db as any, "org", START, 30);
    expect(at.toISOString()).toBe("2027-01-02T00:00:00.000Z");
  });

  it("never shortens grace: an invoice due inside the 30 days keeps the 30", async () => {
    const { db } = dbOwing({ due_date: "2026-11-20" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = await graceLocksAt(db as any, "org", START, 30);
    expect(at.toISOString()).toBe("2026-12-12T15:00:00.000Z");
  });

  it("only counts an unpaid invoice that buys a coverage period, never a booth invoice", async () => {
    const { db, filters } = dbOwing(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await graceLocksAt(db as any, "org", START, 30);
    expect(filters).toContainEqual(["eq", "status", "invoiced"]);
    expect(filters).toContainEqual(["not", "billing_period_end", "is", null]);
  });
});
