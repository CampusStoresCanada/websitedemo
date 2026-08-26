import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, canManageOrganization } from "@/lib/auth/guards";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * What an organisation has bought for a conference, and what it still owes.
 *
 * ⚠️ Settled is read from `status`, never from `paid_at`.
 *
 * `paid_at` is not reliably populated: on this conference one order carries
 * status 'paid' with a null `paid_at` (Varsity Collection, $9,040, two
 * booths). Anything that gates on the timestamp tells that company it has not
 * paid for booths it holds. `status` is what the refund and reconciliation
 * paths maintain, so `status` is the answer.
 */

export type OrgOrder = {
  id: string;
  status: string;
  /** Tax-inclusive, in cents. */
  totalCents: number;
  taxCents: number;
  refundedCents: number;
  currency: string;
  orderedOn: string;
  /** What the money bought, resolved through order items to catalogue entities. */
  bought: string[];
};

export type OrgPaymentSummary = {
  orders: OrgOrder[];
  /** Orders still awaiting payment — the only thing that makes this a to-do. */
  outstanding: OrgOrder[];
  /**
   * What is still owed. A meaningful sum: these are debts of the same kind.
   *
   * ⚠️ There is deliberately NO "total settled" counterpart. Summing settled
   * orders produces a number nobody should act on — Varsity Collection has a
   * $13,560 order, partially refunded to a $9,040 net, carrying NO line items,
   * beside a $9,040 order that accounts for every booth and registration they
   * hold. Adding those gave "$18,080 settled" for $9,040 of things. A figure
   * that disagrees with a company's own accounting is worse than no figure.
   */
  outstandingCents: number;
  currency: string;
};

/** An order in one of these is finished as far as money is concerned. */
const SETTLED = new Set(["paid", "partially_refunded", "refunded"]);
/** Never chase a cancelled order — it is not a debt, it is a decision. */
const IGNORED = new Set(["canceled", "cancelled", "expired"]);

export async function loadOrgPayments(
  db: AdminClient,
  conferenceId: string,
  organizationId: string
): Promise<OrgPaymentSummary> {
  // Defence in depth. Today the only caller is a page that has already run
  // requireOrgAdminOrSuperAdmin, but this returns payment and agreement data
  // for a named organisation — if it is ever called from a route that forgets
  // to guard, that is a leak with no error to notice. Cheap to re-check.
  const auth = await requireAuthenticated();
  if (!auth.ok || !canManageOrganization(auth.ctx, organizationId)) {
    throw new Error("Not authorized for this organization");
  }

  const { data: rows } = await db
    .from("conference_orders")
    .select("id, status, subtotal_cents, tax_cents, total_cents, currency, refund_amount_cents, created_at")
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  const orderIds = (rows ?? []).map((r) => r.id);
  // conference_orders → order items → entity purchases → the catalogue entity.
  // Without this an order is a number with no explanation, which is exactly
  // what makes a payment line impossible to check.
  const boughtByOrder = new Map<string, string[]>();
  if (orderIds.length > 0) {
    const { data: items } = await db
      .from("conference_order_items")
      .select("id, order_id, purchases:entity_purchases(quantity, entity:conference_entities!entity_purchases_offer_entity_id_fkey(name))")
      .in("order_id", orderIds);
    for (const item of items ?? []) {
      const list = boughtByOrder.get(item.order_id) ?? [];
      const purchases = (item.purchases ?? []) as unknown as {
        quantity: number; entity: { name: string } | { name: string }[] | null;
      }[];
      for (const p of purchases) {
        const entity = Array.isArray(p.entity) ? p.entity[0] : p.entity;
        if (entity?.name) list.push(p.quantity > 1 ? `${entity.name} ×${p.quantity}` : entity.name);
      }
      boughtByOrder.set(item.order_id, list);
    }
  }

  const orders: OrgOrder[] = (rows ?? [])
    .filter((r) => !IGNORED.has(r.status))
    .map((r) => ({
      id: r.id,
      status: r.status,
      totalCents: r.total_cents ?? 0,
      taxCents: r.tax_cents ?? 0,
      refundedCents: r.refund_amount_cents ?? 0,
      currency: r.currency ?? "CAD",
      orderedOn: r.created_at,
      bought: boughtByOrder.get(r.id) ?? [],
    }));

  const outstanding = orders.filter((o) => !SETTLED.has(o.status));

  return {
    orders,
    outstanding,
    outstandingCents: outstanding.reduce((sum, o) => sum + o.totalCents, 0),
    currency: orders[0]?.currency ?? "CAD",
  };
}

/** Cents to a readable amount. Money is never rendered by hand elsewhere either. */
export function formatMoney(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
