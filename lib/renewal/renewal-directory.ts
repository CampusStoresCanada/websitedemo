import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingConfig } from "@/lib/policy/engine";
import { determineTierCode } from "@/lib/stripe/billing";

export type RenewalDirectoryOrgType = "Member" | "Vendor Partner";

export interface RenewalDirectoryRow {
  id: string;
  slug: string;
  name: string;
  type: RenewalDirectoryOrgType;
  logoUrl: string | null;
  orgAdminName: string | null;
  /** Circle community_member_id (numeric, stored as string on contacts) —
   *  when present, the org-admin name opens a Circle DM; when null, it's a
   *  plain mailto link instead. */
  orgAdminCircleId: number | null;
  orgAdminEmail: string | null;
  membershipStatus: string | null;
  /** 2-letter tier code (e.g. "XS"-"XL") — Member orgs only, null otherwise
   *  or when the matched tier has no code set. */
  typeClass: string | null;
  fte: number | null;
  membershipExpiresAt: string | null;
  /** Most recent membership/partnership invoice, pre-tax. Null if the org
   *  has never had a standalone invoice (bundled-checkout-only renewals). */
  renewalAmountCents: number | null;
  invoiceStatus: string | null;
  invoicePdfUrl: string | null;
  /** Fallback for orgs with no standalone invoice: their most recent paid
   *  conference_orders id that included a bundled membership_renewal
   *  purchase, for a Stripe receipt link instead of an invoice PDF. */
  receiptOrderId: string | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function findBundledRenewalOrderIds(
  db: AdminClient,
  orgIds: string[]
): Promise<Map<string, string>> {
  const receiptOrderByOrg = new Map<string, string>();
  if (orgIds.length === 0) return receiptOrderByOrg;

  const { data: renewalEntities } = await db
    .from("conference_entities")
    .select("id")
    .eq("kind", "membership_renewal");
  const entityIds = (renewalEntities ?? []).map((e) => e.id);
  if (entityIds.length === 0) return receiptOrderByOrg;

  const { data: purchases } = await db
    .from("entity_purchases")
    .select("order_item_id")
    .in("offer_entity_id", entityIds);
  const orderItemIds = Array.from(
    new Set((purchases ?? []).map((p) => p.order_item_id).filter((id): id is string => !!id))
  );
  if (orderItemIds.length === 0) return receiptOrderByOrg;

  const { data: orderItems } = await db
    .from("conference_order_items")
    .select("order_id")
    .in("id", orderItemIds);
  const orderIds = Array.from(
    new Set((orderItems ?? []).map((oi) => oi.order_id).filter((id): id is string => !!id))
  );
  if (orderIds.length === 0) return receiptOrderByOrg;

  const { data: orders } = await db
    .from("conference_orders")
    .select("id, organization_id, paid_at")
    .in("id", orderIds)
    .in("organization_id", orgIds)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false });

  for (const order of orders ?? []) {
    if (!receiptOrderByOrg.has(order.organization_id)) {
      receiptOrderByOrg.set(order.organization_id, order.id);
    }
  }
  return receiptOrderByOrg;
}

/**
 * Full active-org membership roster with renewal info — the replacement
 * list for /admin/membership. Not season-gated (unlike the admin-dashboard
 * renewals widget): every active Member/Vendor Partner org appears, with
 * their most recent renewal cycle's data regardless of whether a season is
 * currently open.
 */
export async function getRenewalDirectory(): Promise<RenewalDirectoryRow[]> {
  const db = createAdminClient();

  const [{ data: orgs }, billing] = await Promise.all([
    db
      .from("organizations")
      .select("id, slug, name, type, logo_url, logo_horizontal_url, membership_status, fte, membership_expires_at")
      .in("type", ["Member", "Vendor Partner"])
      .eq("is_test", false)
      .not("membership_status", "in", "(canceled,applied)")
      .is("archived_at", null)
      .order("name"),
    getBillingConfig(),
  ]);

  const orgList = orgs ?? [];
  const orgIds = orgList.map((o) => o.id);
  if (orgIds.length === 0) return [];

  const [{ data: contactRows }, { data: invoiceRows }] = await Promise.all([
    db
      .from("contacts")
      .select("organization_id, name, email, work_email, circle_id, is_primary, created_at")
      .in("organization_id", orgIds)
      .is("archived_at", null),
    db
      .from("invoices")
      .select("organization_id, amount_cents, status, invoice_pdf_url, created_at")
      .in("organization_id", orgIds)
      .in("type", ["membership", "partnership"])
      .order("created_at", { ascending: false }),
  ]);

  // Primary contact per org — same preference order as resolveOrgPrimaryContactEmail
  // (lib/supabase/user-lookup.ts): is_primary first, then oldest.
  type ContactRow = {
    name: string;
    email: string | null;
    work_email: string | null;
    circle_id: string | null;
    is_primary: boolean;
    created_at: string | null;
  };
  const contactByOrg = new Map<string, ContactRow>();
  for (const c of contactRows ?? []) {
    if (!c.organization_id) continue;
    const existing = contactByOrg.get(c.organization_id);
    if (!existing) {
      contactByOrg.set(c.organization_id, c);
    } else if (c.is_primary && !existing.is_primary) {
      contactByOrg.set(c.organization_id, c);
    } else if (
      c.is_primary === existing.is_primary &&
      (c.created_at ?? "") < (existing.created_at ?? "")
    ) {
      contactByOrg.set(c.organization_id, c);
    }
  }

  // Most recent invoice per org — rows already ordered desc, keep the first seen.
  const invoiceByOrg = new Map<string, NonNullable<typeof invoiceRows>[number]>();
  for (const inv of invoiceRows ?? []) {
    if (!invoiceByOrg.has(inv.organization_id)) invoiceByOrg.set(inv.organization_id, inv);
  }

  const orgsNeedingReceiptFallback = orgList.filter((o) => !invoiceByOrg.has(o.id)).map((o) => o.id);
  const receiptOrderByOrg = await findBundledRenewalOrderIds(db, orgsNeedingReceiptFallback);

  return orgList.map((o) => {
    const invoice = invoiceByOrg.get(o.id);
    const contact = contactByOrg.get(o.id);
    const type = o.type as RenewalDirectoryOrgType;
    const typeClass = type === "Member" ? determineTierCode(o.fte, billing.membership_tiers) : null;

    // Some legacy rows have circle_id literally set to the string
    // "undefined" rather than a real id or null — guard explicitly rather
    // than relying on NaN happening to be falsy downstream.
    const parsedCircleId = contact?.circle_id ? Number(contact.circle_id) : NaN;
    const orgAdminCircleId = Number.isFinite(parsedCircleId) ? parsedCircleId : null;

    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      type,
      logoUrl: o.logo_url ?? o.logo_horizontal_url ?? null,
      orgAdminName: contact?.name ?? null,
      orgAdminCircleId,
      orgAdminEmail: contact?.work_email ?? contact?.email ?? null,
      membershipStatus: o.membership_status,
      typeClass,
      fte: o.fte,
      membershipExpiresAt: o.membership_expires_at,
      renewalAmountCents: invoice?.amount_cents ?? null,
      invoiceStatus: invoice?.status ?? null,
      invoicePdfUrl: invoice?.invoice_pdf_url ?? null,
      receiptOrderId: invoice ? null : (receiptOrderByOrg.get(o.id) ?? null),
    };
  });
}
