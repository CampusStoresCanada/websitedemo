import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bookkeeper's rule (Ewa, 2026-11-03): an invoice is recorded in
 * QuickBooks on the date it goes out to the customer, the date on the Stripe
 * invoice, and its payment on the day it is paid. Anything dated on or before
 * her closing date lands in a period she has already filed, so it is recorded
 * on the first day after it instead (2026-11-06).
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
let stripeStatus: string;
let updates: Array<{ table: string; values: Record<string, unknown> }>;
let originalRow: { qbo_invoice_id: string | null } | null;
let conferenceOrder: { id: string } | null;
let originalBalance: number;
let sweepDone: string | null;
let openInvoices: Array<{ id: string }>;
let inserts: Array<{ table: string; values: Record<string, unknown> }>;
let upserts: Array<{ table: string; values: Record<string, unknown> }>;

function builder(table: string) {
  let op: "select" | "update" | "insert" | "upsert" = "select";
  let values: Record<string, unknown> = {};
  const filters: Record<string, unknown> = {};
  const result = () => {
    if (op === "insert") {
      inserts.push({ table, values });
      return { data: values, error: null };
    }
    if (op === "upsert") {
      upserts.push({ table, values });
      return { data: null, error: null };
    }
    if (op === "update") {
      updates.push({ table, values });
      if (table === "qbo_export_queue" && values.status === "processing") return { data: [queueRow], error: null };
      return { data: null, error: null };
    }
    if (table === "conference_orders") return { data: conferenceOrder, error: null };
    if (table === "qbo_export_queue" && filters.invoice_id) return { data: originalRow, error: null };
    if (table === "qbo_export_queue") return { data: [{ id: queueRow.id }], error: null };
    if (table === "invoices" && filters.status) return { data: openInvoices, error: null };
    if (table === "invoices") return { data: invoice, error: null };
    if (table === "app_settings" && filters.key === "qbo_pre_rule_sweep_done") {
      return { data: sweepDone ? { value: sweepDone } : null, error: null };
    }
    if (table === "app_settings") return { data: { value: "acct-stripe" }, error: null };
    return { data: null, error: null };
  };
  const self: Record<string, unknown> = {};
  for (const name of ["select", "lt", "or", "limit", "in", "is"]) {
    self[name] = () => self;
  }
  self.eq = (col: string, v: unknown) => {
    filters[col] = v;
    return self;
  };
  self.insert = (v: Record<string, unknown>) => {
    op = "insert";
    values = v;
    return self;
  };
  self.upsert = (v: Record<string, unknown>) => {
    op = "upsert";
    values = v;
    return self;
  };
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

type PostedInvoice = { TxnDate: string; PrivateNote?: string; Line?: Array<{ Description?: string; SalesItemLineDetail: { TaxCodeRef?: { value: string } } }> };
type PostedPayment = { TxnDate: string; Line: Array<{ LinkedTxn: Array<{ TxnId: string }> }> };
const createQBInvoice = vi.fn(async (_input: PostedInvoice) => ({ Id: "qb-inv-1" }));
const createQBPayment = vi.fn(async (_input: PostedPayment) => ({ Id: "qb-pay-1" }));
vi.mock("../client", () => ({
  resolveQBCustomer: async () => ({ Id: "cust-1" }),
  createQBInvoice: (input: PostedInvoice) => createQBInvoice(input),
  createQBPayment: (input: PostedPayment) => createQBPayment(input),
  createQBRefundReceipt: vi.fn(),
  qboDocNumber: (id: string) => `CSC-${id}`,
  findQBDocumentByDocNumber: async () => null,
  fetchQBBookCloseDate: async () => closeDate,
  getQBInvoice: async () => ({ Id: "qb-orig", Balance: originalBalance }),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    invoices: {
      retrieve: async () => ({ status: stripeStatus, status_transitions: { finalized_at: finalizedAt } }),
    },
  },
}));

vi.mock("../conference-export", () => ({
  conferenceOrderInvoiceParts: async () => ({
    customerId: "cust-1",
    currency: "CAD",
    lines: [
      { Amount: 4000, Description: "Booth", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "booth" }, Qty: 1, TaxCodeRef: { value: "hst-on" } } },
      { Amount: 2000, Description: "Meet & Greet", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "sponsor" }, Qty: 1, TaxCodeRef: { value: "hst-on" } } },
    ],
  }),
}));

const { quickbooksExportRun } = await import("../export");

const queueUpdate = () => updates.filter((u) => u.table === "qbo_export_queue" && u.values.status !== "processing").at(-1)?.values;

beforeEach(() => {
  createQBInvoice.mockClear();
  createQBPayment.mockClear();
  updates = [];
  inserts = [];
  upserts = [];
  originalRow = null;
  conferenceOrder = null;
  originalBalance = 0;
  sweepDone = "done";
  openInvoices = [];
  closeDate = "2026-08-31";
  stripeStatus = "open";
  // 2026-11-21 05:30 UTC is still November 20 in the Stripe account's timezone.
  finalizedAt = Date.UTC(2026, 10, 21, 5, 30) / 1000;
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
    created_at: "2026-11-19T18:00:00+00:00",
    metadata: { qbo_item_id: "item-1", qbo_tax_code_ref: "tax-1" },
    organization_id: "org-1",
    stripe_invoice_id: "in_1",
    organization: { id: "org-1", name: "A School", email: null, quickbooks_customer_id: "cust-1", province: "ON", country: "CA" },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quickbooksExportRun, posting at issue", () => {
  it("posts an issued, unpaid invoice dated as the Stripe invoice is, and no payment", async () => {
    await quickbooksExportRun();
    expect(createQBInvoice).toHaveBeenCalledTimes(1);
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-11-20");
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

  it("records an invoice issued into a filed quarter on the first day after it, and says so", async () => {
    finalizedAt = Date.UTC(2026, 11, 3, 15) / 1000; // December 3
    closeDate = "2026-12-31";
    await quickbooksExportRun();
    const posted = createQBInvoice.mock.calls[0][0];
    expect(posted.TxnDate).toBe("2027-01-01");
    expect(posted.PrivateNote).toContain("Issued in Stripe 2026-12-03; recorded 2027-01-01");
    expect(queueUpdate()).toMatchObject({ status: "completed" });
  });

  it("moves a payment dated into a filed quarter the same way", async () => {
    queueRow.qbo_invoice_id = "qb-inv-1";
    invoice.status = "paid";
    invoice.paid_at = "2026-11-25T16:00:00+00:00";
    closeDate = "2026-11-30";
    await quickbooksExportRun();
    expect(createQBPayment.mock.calls[0][0].TxnDate).toBe("2026-12-01");
  });

  it("dates an invoice issued before the rule the day it was paid, not the day it was issued", async () => {
    finalizedAt = Date.UTC(2026, 7, 12, 15) / 1000; // August 12
    invoice.status = "paid";
    invoice.paid_at = "2026-11-02T16:00:00+00:00";
    await quickbooksExportRun();
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-11-02");
    expect(createQBInvoice.mock.calls[0][0].PrivateNote).toContain("Issued in Stripe 2026-08-12");
    expect(createQBPayment.mock.calls[0][0].TxnDate).toBe("2026-11-02");
  });

  it("dates an unpaid invoice issued before the rule the day it posts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
    finalizedAt = Date.UTC(2026, 7, 12, 15) / 1000;
    await quickbooksExportRun();
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-12-01");
    expect(createQBPayment).not.toHaveBeenCalled();
  });

  it("closes the row without posting when the invoice was voided first", async () => {
    invoice.status = "voided";
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "skipped" });
  });

  it("posts a conference order invoiced at the desk as its per-line Invoice at issue", async () => {
    invoice.type = "conference";
    conferenceOrder = { id: "order-1" };
    await quickbooksExportRun();
    const posted = createQBInvoice.mock.calls[0][0];
    expect(posted.Line?.map((l) => [l.Description, l.SalesItemLineDetail.TaxCodeRef?.value])).toEqual([
      ["Booth", "hst-on"],
      ["Meet & Greet", "hst-on"],
    ]);
    expect(posted.TxnDate).toBe("2026-11-20");
    expect(posted.PrivateNote).toContain("Conference order order-1");
    expect(createQBPayment).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "completed", qbo_invoice_id: "qb-inv-1", qbo_payment_id: null });
  });

  it("leaves a conference order paid before it posted to its receipt", async () => {
    invoice.type = "conference";
    invoice.status = "paid";
    invoice.paid_at = "2026-11-25T16:00:00+00:00";
    conferenceOrder = { id: "order-1" };
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "skipped" });
  });

  it("applies the payment to a conference order's Invoice once paid", async () => {
    invoice.type = "conference";
    invoice.status = "paid";
    invoice.paid_at = "2026-11-25T16:00:00+00:00";
    queueRow.qbo_invoice_id = "qb-inv-1";
    conferenceOrder = { id: "order-1" };
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment.mock.calls[0][0].Line[0].LinkedTxn[0].TxnId).toBe("qb-inv-1");
  });

  it("skips an invoice voided in Stripe that our row still shows open", async () => {
    stripeStatus = "void";
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "skipped" });
  });

  it("falls back to the day we created it when Stripe has no finalize time", async () => {
    finalizedAt = null;
    closeDate = null;
    await quickbooksExportRun();
    expect(createQBInvoice.mock.calls[0][0].TxnDate).toBe("2026-11-19");
  });
});

describe("a tax-only correction", () => {
  beforeEach(() => {
    invoice.amount_cents = 13000;
    invoice.tax_amount_cents = 13000;
    invoice.total_cents = 13000;
    invoice.metadata = { correction_type: "tax_only", corrects_invoice_id: "inv-orig" };
    originalRow = { qbo_invoice_id: "qb-orig" };
  });

  it("posts no invoice of its own when issued, and points the row at the original", async () => {
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "completed", qbo_invoice_id: "qb-orig", qbo_payment_id: null });
  });

  it("pays down the original invoice when it is paid", async () => {
    invoice.status = "paid";
    invoice.paid_at = "2026-11-25T16:00:00+00:00";
    originalBalance = 130;
    await quickbooksExportRun();
    expect(createQBInvoice).not.toHaveBeenCalled();
    expect(createQBPayment.mock.calls[0][0].Line[0].LinkedTxn[0].TxnId).toBe("qb-orig");
    expect(createQBPayment.mock.calls[0][0].TxnDate).toBe("2026-11-25");
    expect(queueUpdate()).toMatchObject({ status: "completed", qbo_invoice_id: "qb-orig", qbo_payment_id: "qb-pay-1" });
  });

  it("holds for the bookkeeper when the original has less than the correction open", async () => {
    invoice.status = "paid";
    invoice.paid_at = "2026-11-25T16:00:00+00:00";
    originalBalance = 0;
    const result = await quickbooksExportRun();
    expect(createQBPayment).not.toHaveBeenCalled();
    expect(queueUpdate()).toMatchObject({ status: "failed", next_retry_at: null });
    expect(String(queueUpdate()?.error_message)).toContain("qb-orig");
    expect(result.failed).toBe(1);
  });
});

describe("the December 1 sweep", () => {
  it("does nothing before December 1", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T15:00:00Z"));
    sweepDone = null;
    openInvoices = [{ id: "old-1" }];
    await quickbooksExportRun();
    expect(inserts).toEqual([]);
    expect(upserts).toEqual([]);
  });

  it("queues every pre-rule invoice still open, once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
    sweepDone = null;
    openInvoices = [{ id: "old-1" }, { id: "old-2" }];
    await quickbooksExportRun();
    expect(inserts.map((i) => i.values.invoice_id)).toEqual(["old-1", "old-2"]);
    expect(upserts[0].values.key).toBe("qbo_pre_rule_sweep_done");
  });

  it("does not sweep twice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T15:00:00Z"));
    openInvoices = [{ id: "old-1" }];
    await quickbooksExportRun();
    expect(inserts).toEqual([]);
  });
});
