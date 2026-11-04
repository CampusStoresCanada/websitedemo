import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bookkeeper's rule (Ewa, 2026-11-03): an invoice is recorded in
 * QuickBooks on the date it goes out to the customer, the date on the Stripe
 * invoice, and its payment on the day it is paid. Anything dated on or before
 * her closing date lands in a period she has already filed, so it waits for
 * her instead of being posted.
 */

type Row = {
  id: string;
  invoice_id: string;
  qbo_invoice_id: string | null;
  qbo_payment_id: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
};

let queueRow: Row;
let invoice: Record<string, unknown>;
let closeDate: string | null;
let finalizedAt: number | null;
let updates: Array<{ table: string; values: Record<string, unknown> }>;

function builder(table: string) {
  let op: "select" | "update" = "select";
  let values: Record<string, unknown> = {};
  const result = () => {
    if (op === "update") {
      updates.push({ table, values });
      if (table === "qbo_export_queue" && values.status === "processing") return { data: [queueRow], error: null };
      return { data: null, error: null };
    }
    if (table === "qbo_export_queue") return { data: [{ id: queueRow.id }], error: null };
    if (table === "invoices") return { data: invoice, error: null };
    if (table === "app_settings") return { data: { value: "acct-stripe" }, error: null };
    return { data: null, error: null };
  };
  const self: Record<string, unknown> = {};
  for (const name of ["select", "eq", "lt", "or", "limit", "in", "is"]) {
    self[name] = () => self;
  }
  self.update = (v: Record<string, unknown>) => {
    op = "update";
    values = v;
    return self;
  };
  for (const name of ["single", "maybeSingle", "returns"]) {
    self[name] = () => Promise.resolve(result());
  }
  (self as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result());
  return self;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock("@/lib/data", () => ({ isFeatureEnabled: async () => true }));
vi.mock("@/lib/ops/alerts", () => ({ raiseAlertIfNotOpen: vi.fn() }));
vi.mock("@/lib/supabase/user-lookup", () => ({
  resolveOrgAdminEmails: async () => [],
  resolveOrgPrimaryContactEmail: async () => null,
}));
vi.mock("../queue", () => ({
  adoptExistingReceipt: vi.fn(),
  failQueueRow: vi.fn(async () => false),
  releaseUnprocessedRows: vi.fn(),
  startRunBudget: () => () => false,
}));

const createQBInvoice = vi.fn(async (_input: { TxnDate: string }) => ({ Id: "qb-inv-1" }));
const createQBPayment = vi.fn(async (_input: { TxnDate: string }) => ({ Id: "qb-pay-1" }));
vi.mock("../client", () => ({
  resolveQBCustomer: async () => ({ Id: "cust-1" }),
  createQBInvoice: (input: { TxnDate: string }) => createQBInvoice(input),
  createQBPayment: (input: { TxnDate: string }) => createQBPayment(input),
  createQBRefundReceipt: vi.fn(),
  qboDocNumber: (id: string) => `CSC-${id}`,
  findQBDocumentByDocNumber: async () => null,
  fetchQBBookCloseDate: async () => closeDate,
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    invoices: {
      retrieve: async () => ({ status_transitions: { finalized_at: finalizedAt } }),
    },
  },
}));

const { quickbooksExportRun } = await import("../export");

const queueUpdate = () => updates.filter((u) => u.table === "qbo_export_queue" && u.values.status !== "processing").at(-1)?.values;

beforeEach(() => {
  createQBInvoice.mockClear();
  createQBPayment.mockClear();
  updates = [];
  closeDate = "2026-08-31";
  // 2026-11-04 05:30 UTC is still November 3 in the Stripe account's timezone.
  finalizedAt = Date.UTC(2026, 10, 4, 5, 30) / 1000;
  queueRow = { id: "row-1", invoice_id: "inv-1", qbo_invoice_id: null, qbo_payment_id: null, status: "pending", retry_count: 0, max_retries: 3 };
  invoice = {
    id: "inv-1",
    type: "membership",
    description: "Membership 2026-27",
    amount_cents: 100000,
    tax_amount_cents: 13000,
    total_cents: 113000,
    currency: "CAD",
    status: "invoiced",
    paid_at: null,
    due_date: "2026-12-03",
    created_at: "2026-11-02T18:00:00+00:00",
    metadata: { qbo_item_id: "item-1", qbo_tax_code_ref: "tax-1" },
    organization_id: "org-1",
    stripe_invoice_id: "in_1",
    organization: { id: "org-1", name: "A School", email: null, quickbooks_customer_id: "cust-1", province: "ON", country: "CA" },
  };
});

describe("quickbooksExportRun, posting at issue", () => {
  it("posts an issued, unpaid invoice dated as the Stripe invoice is, and no payment", async () => {
    await quickbooksExportRun();
    expect(createQBInvoice).toHaveBeenCalledTimes(1);
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-11-03");
    expect(createQBPayment).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "completed", qbo_invoice_id: "qb-inv-1", qbo_payment_id: null });
  });

  it("posts only the payment, dated the day it was paid, for an invoice already in QuickBooks", async () => {
    queueRow.qbo_invoice_id = "qb-inv-1";
    invoice.status = "paid";
    invoice.paid_at = "2026-12-01T16:00:00"; // a Supabase timestamp with no zone is UTC
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment.mock.calls[0][0].TxnDate).toBe("2026-12-01");
    expect(queueUpdate()).toMatchObject({ status: "completed", qbo_payment_id: "qb-pay-1" });
  });

  it("holds an invoice issued into a closed period, posting nothing", async () => {
    finalizedAt = Date.UTC(2026, 7, 12, 15) / 1000; // August 12
    invoice.status = "paid";
    invoice.paid_at = "2026-11-02T16:00:00+00:00";
    const result = await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment).not.toHaveBeenCalled();
    const held = queueUpdate();
    expect(held).toMatchObject({ status: "failed", retry_count: 3, next_retry_at: null });
    expect(String(held?.error_message)).toContain("2026-08-12");
    expect(String(held?.error_message)).toContain("2026-08-31");
    expect(result.failed).toBe(1);
  });

  it("posts the same invoice once the closing date is cleared", async () => {
    finalizedAt = Date.UTC(2026, 7, 12, 15) / 1000;
    closeDate = null;
    await quickbooksExportRun();
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-08-12");
  });

  it("closes the row without posting when the invoice was voided first", async () => {
    invoice.status = "voided";
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "skipped" });
  });

  it("falls back to the day we created it when Stripe has no finalize time", async () => {
    finalizedAt = null;
    closeDate = null;
    await quickbooksExportRun();
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-11-02");
  });
});
