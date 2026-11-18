/**
 * What QuickBooks shows as owing, set beside what the site has open.
 *
 * QuickBooks is the standard for who owes what (Steve, 2026-11-17): the
 * bookkeeper reconciles it against the bank, while Stripe and the site only
 * know what someone clicked. So the question this answers is, for every
 * balance QuickBooks carries: does the site already have an open invoice
 * asking for it? Where it does not, staff can bill it from
 * /admin/membership/balances (lib/actions/quickbooks-balances.ts).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listQBOpenInvoices } from "@/lib/quickbooks/client";
import { selectInChunks } from "@/lib/supabase/select-in-chunks";
import type { QBInvoice } from "@/lib/quickbooks/types";

type Db = ReturnType<typeof createAdminClient>;

/** A site invoice that has not been paid, voided or refunded: still asking for money. */
const OPEN_STATUSES = new Set(["draft", "invoiced", "pending_settlement", "overdue", "failed"]);

export interface BalanceOrg {
  id: string;
  name: string;
  slug: string | null;
  quickbooks_customer_id: string | null;
}

export interface BalanceSiteInvoice {
  id: string;
  organization_id: string | null;
  type: string | null;
  status: string;
  total_cents: number;
  metadata: Record<string, unknown> | null;
}

export type BalanceState =
  /** The site has no open invoice for this balance: it can be billed. */
  | "billable"
  /** An open site invoice already asks for exactly this. */
  | "billed"
  /** An open site invoice covers it, for a different amount. */
  | "billed_differs"
  /** No organization on the site is linked to this QuickBooks customer. */
  | "no_org"
  /** Not in Canadian dollars; the site only bills CAD. */
  | "other_currency";

export interface QuickBooksBalance {
  qboInvoiceId: string;
  docNumber: string | null;
  txnDate: string | null;
  customerId: string;
  customerName: string | null;
  totalCents: number;
  owingCents: number;
  org: { id: string; name: string; slug: string | null } | null;
  /** The site invoice that was posted to QuickBooks as this one, if the site made it. */
  original: { id: string; type: string | null; status: string; totalCents: number } | null;
  /** The open site invoice already asking for this balance, if any. */
  openOnSite: { id: string; status: string; totalCents: number } | null;
  state: BalanceState;
}

function isBalanceInvoice(meta: Record<string, unknown> | null): boolean {
  return typeof meta?.pays_qbo_invoice_id === "string" || meta?.correction_type === "tax_only";
}

/**
 * Pure: line QuickBooks' open invoices up against the site's records.
 * `postedAs` maps a site invoice id to the QuickBooks invoice it was posted as
 * (qbo_export_queue). A balance invoice's queue row carries the id of the
 * invoice it pays down, so several site invoices can share one.
 */
export function matchQuickBooksBalances(
  qbInvoices: QBInvoice[],
  orgs: BalanceOrg[],
  siteInvoices: BalanceSiteInvoice[],
  postedAs: Array<{ invoice_id: string; qbo_invoice_id: string | null }>
): QuickBooksBalance[] {
  const orgByCustomer = new Map(orgs.filter((o) => o.quickbooks_customer_id).map((o) => [o.quickbooks_customer_id!, o]));
  const siteById = new Map(siteInvoices.map((i) => [i.id, i]));

  const rows = qbInvoices.map((qb): QuickBooksBalance => {
    const customer = qb.CustomerRef as { value: string; name?: string };
    const org = orgByCustomer.get(customer.value) ?? null;
    const owingCents = Math.round(qb.Balance * 100);

    const posted = postedAs
      .filter((p) => p.qbo_invoice_id === qb.Id)
      .map((p) => siteById.get(p.invoice_id))
      .filter((i): i is BalanceSiteInvoice => Boolean(i));
    const original = posted.find((i) => !isBalanceInvoice(i.metadata)) ?? null;

    const open = org
      ? siteInvoices.find(
          (i) =>
            i.organization_id === org.id &&
            OPEN_STATUSES.has(i.status) &&
            (i.id === original?.id ||
              i.metadata?.pays_qbo_invoice_id === qb.Id ||
              (original !== null && i.metadata?.corrects_invoice_id === original.id))
        ) ?? null
      : null;

    const currency = (qb.CurrencyRef?.value ?? "CAD").toUpperCase();
    const state: BalanceState = !org
      ? "no_org"
      : currency !== "CAD"
        ? "other_currency"
        : !open
          ? "billable"
          : open.total_cents === owingCents
            ? "billed"
            : "billed_differs";

    return {
      qboInvoiceId: qb.Id,
      docNumber: qb.DocNumber ?? null,
      txnDate: qb.TxnDate ?? null,
      customerId: customer.value,
      customerName: customer.name ?? null,
      totalCents: Math.round(qb.TotalAmt * 100),
      owingCents,
      org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      original: original
        ? { id: original.id, type: original.type, status: original.status, totalCents: original.total_cents }
        : null,
      openOnSite: open ? { id: open.id, status: open.status, totalCents: open.total_cents } : null,
      state,
    };
  });

  // What still needs someone first, then by name.
  const order: Record<BalanceState, number> = { billable: 0, billed_differs: 1, no_org: 2, other_currency: 3, billed: 4 };
  return rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (a.org?.name ?? a.customerName ?? "").localeCompare(b.org?.name ?? b.customerName ?? "")
  );
}

/** Read QuickBooks and the site, and line them up. Throws if QuickBooks cannot be read. */
export async function loadQuickBooksBalances(db: Db): Promise<QuickBooksBalance[]> {
  const qbInvoices = await listQBOpenInvoices();
  if (qbInvoices.length === 0) return [];

  const customerIds = [...new Set(qbInvoices.map((i) => i.CustomerRef.value))];
  const orgs = await selectInChunks<BalanceOrg>(customerIds, (chunk) =>
    db.from("organizations").select("id, name, slug, quickbooks_customer_id").in("quickbooks_customer_id", chunk)
  );
  if (orgs.error) throw new Error(`Could not read organizations: ${orgs.error.message}`);

  const posted = await selectInChunks<{ invoice_id: string; qbo_invoice_id: string | null }>(
    qbInvoices.map((i) => i.Id),
    (chunk) => db.from("qbo_export_queue").select("invoice_id, qbo_invoice_id").in("qbo_invoice_id", chunk)
  );
  if (posted.error) throw new Error(`Could not read the QuickBooks queue: ${posted.error.message}`);

  // Every invoice these organizations have: the originals, and anything open.
  const site = await selectInChunks<BalanceSiteInvoice>(
    orgs.data.map((o) => o.id),
    (chunk) =>
      db.from("invoices").select("id, organization_id, type, status, total_cents, metadata").in("organization_id", chunk)
  );
  if (site.error) throw new Error(`Could not read invoices: ${site.error.message}`);

  return matchQuickBooksBalances(qbInvoices, orgs.data, site.data, posted.data);
}
