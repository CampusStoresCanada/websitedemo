import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/quickbooks/client", () => ({ listQBOpenInvoices: vi.fn() }));

import { matchQuickBooksBalances, type BalanceSiteInvoice } from "../quickbooks-balances";
import type { QBInvoice } from "@/lib/quickbooks/types";

function qb(id: string, customer: string, total: number, balance: number, extra: Partial<QBInvoice> = {}): QBInvoice {
  return {
    Id: id,
    SyncToken: "0",
    CustomerRef: { value: customer },
    Line: [],
    TotalAmt: total,
    Balance: balance,
    TxnDate: "2026-08-05",
    ...extra,
  };
}

function site(id: string, org: string, status: string, total: number, metadata: Record<string, unknown> | null = null): BalanceSiteInvoice {
  return { id, organization_id: org, type: "partnership", status, total_cents: total, metadata };
}

const orgs = [
  { id: "org-hype", name: "Hype and Vice", slug: "hype-and-vice", quickbooks_customer_id: "9" },
  { id: "org-jail", name: "Jailbird Designs", slug: "jailbird-designs", quickbooks_customer_id: "152" },
  { id: "org-mac", name: "McMaster University", slug: "mcmaster", quickbooks_customer_id: "40" },
  { id: "org-kiv", name: "Kivuto Solutions", slug: "kivuto-solutions", quickbooks_customer_id: "300" },
];

describe("matchQuickBooksBalances", () => {
  it("offers a balance the site calls paid in full", () => {
    // Billed $600 with no tax; QuickBooks booked $630 and still shows $30.
    const [row] = matchQuickBooksBalances(
      [qb("1188", "9", 630, 30)],
      orgs,
      [site("inv-hype", "org-hype", "paid", 60000)],
      [{ invoice_id: "inv-hype", qbo_invoice_id: "1188" }]
    );
    expect(row.state).toBe("billable");
    expect(row.owingCents).toBe(3000);
    expect(row.org?.id).toBe("org-hype");
    expect(row.original).toMatchObject({ id: "inv-hype", status: "paid", totalCents: 60000 });
  });

  it("offers a balance on an invoice the site never made", () => {
    // The booth invoice was made in the Stripe dashboard and entered by hand.
    const [row] = matchQuickBooksBalances(
      [qb("1253", "152", 6780, 4780)],
      orgs,
      [site("inv-void", "org-jail", "voided", 678000)],
      []
    );
    expect(row.state).toBe("billable");
    expect(row.original).toBeNull();
    expect(row.owingCents).toBe(478000);
  });

  it("does not offer a balance an August tax correction is already asking for", () => {
    const [row] = matchQuickBooksBalances(
      [qb("1000", "40", 1130, 130)],
      orgs,
      [
        site("inv-mac", "org-mac", "paid", 100000),
        site("inv-mac-tax", "org-mac", "invoiced", 13000, { correction_type: "tax_only", corrects_invoice_id: "inv-mac" }),
      ],
      [{ invoice_id: "inv-mac", qbo_invoice_id: "1000" }]
    );
    expect(row.state).toBe("billed");
    expect(row.openOnSite?.id).toBe("inv-mac-tax");
  });

  it("does not offer a balance once it has been billed from here", () => {
    const [row] = matchQuickBooksBalances(
      [qb("1253", "152", 6780, 4780)],
      orgs,
      [site("inv-bal", "org-jail", "invoiced", 478000, { pays_qbo_invoice_id: "1253" })],
      // Its own queue row points at the invoice it pays down.
      [{ invoice_id: "inv-bal", qbo_invoice_id: "1253" }]
    );
    expect(row.state).toBe("billed");
    expect(row.original).toBeNull();
  });

  it("treats an invoice that is simply still open on the site as billed", () => {
    const [row] = matchQuickBooksBalances(
      [qb("1419", "300", 7410, 7410)],
      orgs,
      [site("inv-kiv", "org-kiv", "invoiced", 741000)],
      [{ invoice_id: "inv-kiv", qbo_invoice_id: "1419" }]
    );
    expect(row.state).toBe("billed");
  });

  it("flags an open site invoice for a different amount rather than offering a second one", () => {
    const [row] = matchQuickBooksBalances(
      [qb("1000", "40", 1130, 130)],
      orgs,
      [
        site("inv-mac", "org-mac", "paid", 100000),
        site("inv-mac-tax", "org-mac", "invoiced", 9000, { correction_type: "tax_only", corrects_invoice_id: "inv-mac" }),
      ],
      [{ invoice_id: "inv-mac", qbo_invoice_id: "1000" }]
    );
    expect(row.state).toBe("billed_differs");
  });

  it("offers it again when the earlier balance invoice was voided", () => {
    const [row] = matchQuickBooksBalances(
      [qb("1253", "152", 6780, 4780)],
      orgs,
      [site("inv-bal", "org-jail", "voided", 478000, { pays_qbo_invoice_id: "1253" })],
      [{ invoice_id: "inv-bal", qbo_invoice_id: "1253" }]
    );
    expect(row.state).toBe("billable");
  });

  it("will not bill a customer no organization is linked to, or another currency", () => {
    const rows = matchQuickBooksBalances(
      [qb("77", "296", 678, 678), qb("78", "9", 500, 500, { CurrencyRef: { value: "USD" } })],
      orgs,
      [],
      []
    );
    expect(rows.find((r) => r.qboInvoiceId === "77")?.state).toBe("no_org");
    expect(rows.find((r) => r.qboInvoiceId === "78")?.state).toBe("other_currency");
  });

  it("lists what needs billing first", () => {
    const rows = matchQuickBooksBalances(
      [qb("1419", "300", 7410, 7410), qb("1188", "9", 630, 30)],
      orgs,
      [site("inv-kiv", "org-kiv", "invoiced", 741000), site("inv-hype", "org-hype", "paid", 60000)],
      [
        { invoice_id: "inv-kiv", qbo_invoice_id: "1419" },
        { invoice_id: "inv-hype", qbo_invoice_id: "1188" },
      ]
    );
    expect(rows.map((r) => r.state)).toEqual(["billable", "billed"]);
  });
});
