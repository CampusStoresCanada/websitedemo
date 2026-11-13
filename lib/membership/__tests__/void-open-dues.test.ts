import { beforeEach, describe, expect, it, vi } from "vitest";

const { stripeMock, raiseAlertMock } = vi.hoisted(() => ({
  stripeMock: {
    invoices: { retrieve: vi.fn(), voidInvoice: vi.fn(), del: vi.fn() },
  },
  raiseAlertMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ stripe: stripeMock }));
vi.mock("@/lib/ops/alerts", () => ({ raiseAlertIfNotOpen: raiseAlertMock }));
vi.mock("@/lib/membership/state-machine", () => ({ transitionMembershipState: vi.fn() }));

import { voidOpenDuesInvoices } from "../renewal-activation";

/**
 * Moving the dues onto a combined conference invoice (Kivuto, 2026-11-13: one
 * invoice, the standalone voided) and paying the dues both void the org's
 * other open dues invoices, and only those.
 */

type Row = Record<string, unknown>;
function fakeDb(invoices: Row[], qbo: Row[] = []) {
  const tables: Record<string, Row[]> = { invoices, qbo_export_queue: qbo };
  const from = (table: string) => {
    let rows = [...tables[table]];
    let patch: Row | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      neq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      not: (c: string, _op: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) for (const r of rows) Object.assign(r, patch);
        return resolve({ data: rows, error: null });
      },
    });
    return q;
  };
  return { tables, db: { from } };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock.invoices.retrieve.mockResolvedValue({ status: "open" });
});

describe("voidOpenDuesInvoices", () => {
  it("voids the open partnership invoice, in Stripe and here", async () => {
    const { tables, db } = fakeDb([
      { id: "dues", organization_id: "org", type: "partnership", status: "invoiced", stripe_invoice_id: "in_dues", total_cents: 63000 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voided = await voidOpenDuesInvoices(db as any, "org", { reason: "test" });
    expect(voided).toEqual(["dues"]);
    expect(tables.invoices[0].status).toBe("voided");
    expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith("in_dues");
  });

  it("never touches a conference invoice, or the invoice being kept", async () => {
    const { tables, db } = fakeDb([
      { id: "booth", organization_id: "org", type: "conference", status: "invoiced", stripe_invoice_id: "in_booth" },
      { id: "keep", organization_id: "org", type: "membership", status: "invoiced", stripe_invoice_id: "in_keep" },
      { id: "other-org", organization_id: "org2", type: "membership", status: "invoiced", stripe_invoice_id: "in_x" },
      { id: "paid", organization_id: "org", type: "membership", status: "paid", stripe_invoice_id: "in_paid" },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voided = await voidOpenDuesInvoices(db as any, "org", { exceptInvoiceId: "keep", reason: "test" });
    expect(voided).toEqual([]);
    expect(tables.invoices.map((i) => i.status)).toEqual(["invoiced", "invoiced", "invoiced", "paid"]);
    expect(stripeMock.invoices.voidInvoice).not.toHaveBeenCalled();
  });

  it("asks the bookkeeper to void it in QuickBooks when it already posted", async () => {
    const { db } = fakeDb(
      [{ id: "dues", organization_id: "org", type: "partnership", status: "invoiced", stripe_invoice_id: "in_dues", total_cents: 63000 }],
      [{ invoice_id: "dues", qbo_invoice_id: "4512" }]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await voidOpenDuesInvoices(db as any, "org", { reason: "billed on conference invoice X" });
    expect(raiseAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "qbo_void_needed:dues", details: expect.objectContaining({ qbo_invoice_id: "4512" }) })
    );
  });

  it("raises nothing when it never reached QuickBooks (the export skips it)", async () => {
    const { db } = fakeDb(
      [{ id: "dues", organization_id: "org", type: "partnership", status: "invoiced", stripe_invoice_id: null }],
      [{ invoice_id: "dues", qbo_invoice_id: null }]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await voidOpenDuesInvoices(db as any, "org", { reason: "test" });
    expect(raiseAlertMock).not.toHaveBeenCalled();
  });
});
