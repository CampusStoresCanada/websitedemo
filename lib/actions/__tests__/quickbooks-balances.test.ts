import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickBooksBalance } from "@/lib/billing/quickbooks-balances";

let balances: QuickBooksBalance[] = [];
const inserted: Record<string, unknown>[] = [];
const { invoicesCreate, invoiceItemsCreate, finalizeAndSendInvoice } = vi.hoisted(() => ({
  invoicesCreate: vi.fn(async (_input: Record<string, unknown>) => ({ id: "in_new" })),
  invoiceItemsCreate: vi.fn(async (_input: Record<string, unknown>) => ({})),
  finalizeAndSendInvoice: vi.fn(async (_id: string, _options: { notify?: boolean }) => ({ success: true })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, ctx: { userId: "staff-1" } })),
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: vi.fn() }));
vi.mock("@/lib/billing/quickbooks-balances", () => ({
  loadQuickBooksBalances: vi.fn(async () => balances),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: { invoices: { create: invoicesCreate }, invoiceItems: { create: invoiceItemsCreate } },
}));
vi.mock("@/lib/stripe/billing", () => ({
  ensureStripeCustomer: vi.fn(async () => "cus_1"),
  finalizeAndSendInvoice,
  stripeDueTerms: (due?: string | null) => (due ? { due_date: 1 } : { days_until_due: 30 }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { select: () => ({ single: async () => ({ data: { id: "inv-new" }, error: null }) }) };
      },
    }),
  }),
}));

import { billQuickBooksBalance } from "../quickbooks-balances";

function balance(over: Partial<QuickBooksBalance> = {}): QuickBooksBalance {
  return {
    qboInvoiceId: "1188",
    docNumber: "05587b2b",
    txnDate: "2026-08-02",
    customerId: "9",
    customerName: "Jennifer Radcliffe",
    totalCents: 63000,
    owingCents: 3000,
    org: { id: "org-hype", name: "Hype and Vice", slug: "hype-and-vice" },
    original: { id: "inv-hype", type: "partnership", status: "paid", totalCents: 60000 },
    openOnSite: null,
    state: "billable",
    ...over,
  };
}

beforeEach(() => {
  balances = [balance()];
  inserted.length = 0;
  invoicesCreate.mockClear();
  invoiceItemsCreate.mockClear();
  finalizeAndSendInvoice.mockClear();
});

describe("billQuickBooksBalance", () => {
  it("bills exactly what QuickBooks shows owing, untaxed, tied to the QuickBooks invoice", async () => {
    const result = await billQuickBooksBalance({ qboInvoiceId: "1188", description: "Balance owing", notify: true });
    expect(result).toEqual({ success: true, data: { invoiceId: "inv-new", totalCents: 3000 } });

    const item = invoiceItemsCreate.mock.calls[0][0];
    expect(item).toMatchObject({ invoice: "in_new", amount: 3000, description: "Balance owing" });
    expect(item.tax_rates).toBeUndefined();

    expect(inserted[0]).toMatchObject({
      organization_id: "org-hype",
      type: "partnership",
      amount_cents: 3000,
      tax_amount_cents: 0,
      total_cents: 3000,
      status: "draft",
      stripe_invoice_id: "in_new",
      metadata: { pays_qbo_invoice_id: "1188", corrects_invoice_id: "inv-hype" },
    });
    expect(finalizeAndSendInvoice).toHaveBeenCalledWith("inv-new", { notify: true });
  });

  it("bills an invoice the site never made, and can do it without emailing anyone", async () => {
    balances = [balance({ qboInvoiceId: "1253", owingCents: 478000, original: null })];
    await billQuickBooksBalance({ qboInvoiceId: "1253", description: "Balance owing", notify: false });
    expect(inserted[0]).toMatchObject({ type: "addon", total_cents: 478000, metadata: { pays_qbo_invoice_id: "1253" } });
    expect((inserted[0].metadata as Record<string, unknown>).corrects_invoice_id).toBeUndefined();
    expect(finalizeAndSendInvoice).toHaveBeenCalledWith("inv-new", { notify: false });
  });

  it("refuses a balance the site already has an open invoice for", async () => {
    balances = [balance({ state: "billed", openOnSite: { id: "inv-open", status: "invoiced", totalCents: 3000 } })];
    const result = await billQuickBooksBalance({ qboInvoiceId: "1188", description: "Balance owing", notify: true });
    expect(result.success).toBe(false);
    expect(invoicesCreate).not.toHaveBeenCalled();
  });

  it("refuses when QuickBooks no longer shows the balance", async () => {
    balances = [];
    const result = await billQuickBooksBalance({ qboInvoiceId: "1188", description: "Balance owing", notify: true });
    expect(result).toEqual({ success: false, error: "QuickBooks no longer shows a balance on that invoice." });
    expect(invoicesCreate).not.toHaveBeenCalled();
  });

  it("refuses a customer no organization is linked to, and a blank description", async () => {
    balances = [balance({ state: "no_org", org: null })];
    expect((await billQuickBooksBalance({ qboInvoiceId: "1188", description: "x", notify: true })).success).toBe(false);
    balances = [balance()];
    expect((await billQuickBooksBalance({ qboInvoiceId: "1188", description: "  ", notify: true })).success).toBe(false);
    expect(invoicesCreate).not.toHaveBeenCalled();
  });
});
