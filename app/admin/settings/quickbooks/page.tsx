/**
 * /admin/settings/quickbooks — maps invoice types to QBO items (SA only)
 */
import { redirect } from "next/navigation";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import QBOSettingsForm from "@/components/admin/qbo/QBOSettingsForm";

export const metadata = {
  title: "QuickBooks Settings | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_KEYS = [
  "qbo_item_id_default",
  "qbo_item_id_membership",
  "qbo_item_id_partnership",
  "qbo_membership_price_bands",
  "qbo_item_id_conference_partial_refund",
  "qbo_stripe_deposit_account_id",
  "qbo_membership_tax_codes",
  "qbo_tax_code_outside_canada",
  "qbo_tax_code_public_ticket",
];

export default async function QuickBooksSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) redirect("/admin/ops");

  const db = createAdminClient();
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

  const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));

  let priceBands: Array<{ maxAmount: number; itemId: string | null }> = [];
  if (map["qbo_membership_price_bands"]) {
    try {
      const parsed = JSON.parse(map["qbo_membership_price_bands"]) as Array<{
        maxAmountCents: number;
        itemId: string;
      }>;
      if (Array.isArray(parsed)) {
        priceBands = parsed.map((b) => ({ maxAmount: b.maxAmountCents / 100, itemId: b.itemId }));
      }
    } catch {
      priceBands = [];
    }
  }

  let membershipTaxCodes: Array<{ province: string; taxCodeId: string | null }> = [];
  if (map["qbo_membership_tax_codes"]) {
    try {
      const parsed = JSON.parse(map["qbo_membership_tax_codes"]) as Array<{
        province: string;
        taxCodeId: string;
      }>;
      if (Array.isArray(parsed)) {
        membershipTaxCodes = parsed.map((m) => ({ province: m.province, taxCodeId: m.taxCodeId }));
      }
    } catch {
      membershipTaxCodes = [];
    }
  }

  return (
    <main>
      <AdminPageHeader
        title="QuickBooks Settings"
        description="Maps CSC invoice types to QuickBooks Online items so paid invoices export correctly. Conference commerce (booths, registration, sponsorship) uses per-entity items mapped in the Build tab, and a single tax code set on each conference's Edit page — add-on and other invoice types not listed here use the default item below."
      />
      <QBOSettingsForm
        defaultItemId={map["qbo_item_id_default"] || null}
        membershipItemId={map["qbo_item_id_membership"] || null}
        partnershipItemId={map["qbo_item_id_partnership"] || null}
        priceBands={priceBands}
        conferencePartialRefundItemId={map["qbo_item_id_conference_partial_refund"] || null}
        stripeDepositAccountId={map["qbo_stripe_deposit_account_id"] || null}
        membershipTaxCodes={membershipTaxCodes}
        outsideCanadaTaxCode={map["qbo_tax_code_outside_canada"] || null}
        publicTicketTaxCode={map["qbo_tax_code_public_ticket"] || null}
      />
    </main>
  );
}
