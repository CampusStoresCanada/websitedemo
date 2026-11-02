import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An invoice reaches EVERY org admin, through our email, and the receipt
 * reaches whoever paid.
 *
 * Red River College, 2026-10-30: Stripe's invoice email went to the org's
 * oldest admin only, because an org is one Stripe customer with one address.
 * Stephen: all admins get it; whoever clicks through is on the Stripe session.
 */

const mocks = vi.hoisted(() => ({
  finalizeInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  customersUpdate: vi.fn(),
  sendTransactional: vi.fn(),
  resolveOrgAdminEmails: vi.fn(),
  resolveRenewalRecipients: vi.fn(),
  rows: {} as Record<string, unknown>,
  updates: [] as unknown[],
}));

vi.mock("../client", () => ({
  stripe: {
    invoices: { finalizeInvoice: mocks.finalizeInvoice, sendInvoice: mocks.sendInvoice },
    customers: { update: mocks.customersUpdate },
  },
}));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: mocks.sendTransactional }));
vi.mock("@/lib/renewal/jobs", () => ({ resolveRenewalRecipients: mocks.resolveRenewalRecipients }));
vi.mock("@/lib/supabase/user-lookup", () => ({
  resolveOrgAdminEmails: mocks.resolveOrgAdminEmails,
  resolveOrgPrimaryContactEmail: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: (cols: string) => {
          (chain as { cols?: string }).cols = cols;
          return chain;
        },
        update: (row: unknown) => {
          mocks.updates.push(row);
          return chain;
        },
        eq: () => chain,
        single: async () => ({ data: mocks.rows[(chain as { cols?: string }).cols ?? ""] ?? null }),
      };
      return chain;
    },
  }),
}));

import { finalizeAndSendInvoice, setInvoicePayer } from "../billing";

const HOSTED = "https://invoice.stripe.com/i/acct_1/live_abc?s=ap";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://csc.test";
  mocks.updates.length = 0;
  mocks.rows = {
    "id, stripe_invoice_id, status": { id: "inv-1", stripe_invoice_id: "in_1", status: "draft" },
    "organization_id, description, total_cents, due_date, organizations(name, email)": {
      organization_id: "org-rrc",
      description: "Membership 2026-27",
      total_cents: 93975,
      due_date: "2026-11-29",
      organizations: { name: "Red River College", email: "store@rrc.ca" },
    },
  };
  mocks.finalizeInvoice.mockResolvedValue({ hosted_invoice_url: HOSTED, invoice_pdf: null });
  mocks.sendTransactional.mockResolvedValue({ success: true });
});

describe("finalizeAndSendInvoice", () => {
  it("emails every admin a link to /org/billing for this invoice, and never asks Stripe to send", async () => {
    mocks.resolveOrgAdminEmails.mockResolvedValue(["mebarton@rrc.ca", "khansen2@rrc.ca"]);

    const result = await finalizeAndSendInvoice("inv-1");

    expect(result).toEqual({ success: true, hostedInvoiceUrl: HOSTED });
    expect(mocks.sendInvoice).not.toHaveBeenCalled();
    expect(mocks.sendTransactional.mock.calls.map(([o]) => o.to)).toEqual(["mebarton@rrc.ca", "khansen2@rrc.ca"]);
    const vars = mocks.sendTransactional.mock.calls[0][0].variables;
    expect(mocks.sendTransactional.mock.calls[0][0].templateKey).toBe("invoice_issued");
    expect(vars.invoice_url).toBe("https://csc.test/org/billing?org=org-rrc&invoice=inv-1");
    expect(vars.invoice_amount).toBe("$939.75");
    expect(vars.org_name).toBe("Red River College");
  });

  it("an org with no admin yet gets Stripe's pay link, since it cannot open /org/billing", async () => {
    mocks.resolveOrgAdminEmails.mockResolvedValue([]);
    mocks.resolveRenewalRecipients.mockResolvedValue(["store@rrc.ca"]);

    await finalizeAndSendInvoice("inv-1");

    expect(mocks.sendTransactional).toHaveBeenCalledTimes(1);
    expect(mocks.sendTransactional.mock.calls[0][0].to).toBe("store@rrc.ca");
    expect(mocks.sendTransactional.mock.calls[0][0].variables.invoice_url).toBe(HOSTED);
  });

  it("notify: false (the renewal pause) finalizes and emails nobody", async () => {
    mocks.resolveOrgAdminEmails.mockResolvedValue(["mebarton@rrc.ca"]);

    const result = await finalizeAndSendInvoice("inv-1", { notify: false });

    expect(result.success).toBe(true);
    expect(mocks.finalizeInvoice).toHaveBeenCalledWith("in_1");
    expect(mocks.sendTransactional).not.toHaveBeenCalled();
    expect(mocks.sendInvoice).not.toHaveBeenCalled();
  });

  it("a failed email does not fail the invoice: it is finalized and payable", async () => {
    mocks.resolveOrgAdminEmails.mockRejectedValue(new Error("db down"));

    const result = await finalizeAndSendInvoice("inv-1");

    expect(result.success).toBe(true);
    expect(mocks.updates).toHaveLength(1);
  });
});

describe("setInvoicePayer", () => {
  it("moves the org's one Stripe customer to the payer's email, creating nothing", async () => {
    mocks.rows["stripe_customer_id, organizations(stripe_customer_id)"] = {
      stripe_customer_id: null,
      organizations: { stripe_customer_id: "cus_rrc" },
    };

    await setInvoicePayer("inv-1", "khansen2@rrc.ca");

    expect(mocks.customersUpdate).toHaveBeenCalledWith("cus_rrc", { email: "khansen2@rrc.ca" });
  });
});
