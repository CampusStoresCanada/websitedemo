import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * What each organization is expected to pay for a renewal cycle, in cents,
 * excluding tax.
 *
 * Two sources, in priority order:
 *
 *  1. The **live invoice** for the cycle. This wins. When dues are re-issued at
 *     a corrected figure the original is voided and a new row written — but the
 *     `invoice_generated` renewal event still references the void, so an
 *     event-only lookup quotes a number the member will never be asked to pay.
 *     Observed 2026-08-27: Royal Roads $525 (voided) vs $420 (live), and
 *     Kwantlen Polytechnic $525 (voided) vs $895 (live) — a $105 error in the
 *     member total.
 *
 *  2. The invoice the `invoice_generated` event points at, for orgs with no
 *     live row (typically because a bundled booth checkout voided it on
 *     payment).
 *
 * Callers supply their own final fallback — the Vendor Partner flat rate is
 * exact, whereas Member dues are FTE-tiered with no cheap equivalent.
 */
export async function getExpectedAmountsByOrg(
  db: ReturnType<typeof createAdminClient>,
  orgIds: string[],
  renewalYear: number
): Promise<Map<string, number>> {
  const expected = new Map<string, number>();
  if (orgIds.length === 0) return expected;

  const [eventsRes, liveRes] = await Promise.all([
    db
      .from("renewal_events")
      .select("organization_id, invoice_id")
      .eq("event_type", "invoice_generated")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds),
    db
      .from("invoices")
      .select("organization_id, amount_cents, status, created_at")
      .in("organization_id", orgIds)
      .in("type", ["membership", "partnership"])
      .neq("status", "voided")
      .gte("billing_period_end", `${renewalYear}-01-01`)
      .lte("billing_period_end", `${renewalYear}-12-31`)
      .order("created_at", { ascending: false }),
  ]);

  // Source 2 first, so source 1 overwrites it.
  const invoiceIdByOrg = new Map<string, string>();
  for (const row of eventsRes.data ?? []) {
    if (row.invoice_id) invoiceIdByOrg.set(row.organization_id, row.invoice_id);
  }
  const invoiceIds = Array.from(new Set(invoiceIdByOrg.values()));
  if (invoiceIds.length > 0) {
    const { data: invoices } = await db
      .from("invoices")
      .select("id, amount_cents")
      .in("id", invoiceIds);
    const amountById = new Map((invoices ?? []).map((i) => [i.id, i.amount_cents]));
    for (const [orgId, invoiceId] of invoiceIdByOrg) {
      const amount = amountById.get(invoiceId);
      if (amount !== undefined) expected.set(orgId, amount);
    }
  }

  // Source 1 — prefer paid, then anything that isn't a draft, then newest.
  const rankByOrg = new Map<string, number>();
  for (const inv of liveRes.data ?? []) {
    const rank = inv.status === "paid" ? 2 : inv.status === "draft" ? 0 : 1;
    if (rank >= (rankByOrg.get(inv.organization_id) ?? -1)) {
      // Rows arrive newest-first, so only take the first at a given rank.
      if (rank > (rankByOrg.get(inv.organization_id) ?? -1)) {
        rankByOrg.set(inv.organization_id, rank);
        expected.set(inv.organization_id, inv.amount_cents);
      }
    }
  }

  return expected;
}
