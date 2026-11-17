import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../client", () => ({ stripe: {} }));
vi.mock("../webhook-processing", () => ({ processStripeWebhookEvent: vi.fn(), toWebhookPayloadJson: vi.fn() }));

import { untrackedStripeInvoices } from "@/lib/stripe/reconcile";

const inv = (id: string, status: string, total = 678000) => ({
  id,
  number: `N-${id}`,
  status: status as never,
  total,
  created: 1790000000,
  customer_name: "Greentown Canada",
  customer_email: null,
});

describe("untrackedStripeInvoices", () => {
  it("reports an open or paid invoice the site has no row for", () => {
    const out = untrackedStripeInvoices([inv("in_dash_paid", "paid"), inv("in_dash_open", "open")], new Set());
    expect(out.map((o) => o.stripeInvoiceId)).toEqual(["in_dash_paid", "in_dash_open"]);
    expect(out[0]).toMatchObject({ customer: "Greentown Canada", totalCents: 678000, status: "paid" });
  });

  it("says nothing about an invoice the site made", () => {
    expect(untrackedStripeInvoices([inv("in_ours", "open")], new Set(["in_ours"]))).toEqual([]);
  });

  it("leaves out drafts and voids, which ask nobody for money", () => {
    expect(untrackedStripeInvoices([inv("in_draft", "draft"), inv("in_void", "void")], new Set())).toEqual([]);
  });
});
