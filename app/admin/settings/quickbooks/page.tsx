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
  "qbo_refresh_token",
  "qbo_item_id_default",
  "qbo_item_id_membership",
  "qbo_item_id_partnership",
  "qbo_membership_price_bands",
  "qbo_item_id_conference_partial_refund",
  "qbo_item_id_conference_connected_booth",
  "qbo_item_id_conference_exhibitor_booth",
  "qbo_stripe_deposit_account_id",
  "qbo_membership_tax_codes",
  "qbo_tax_code_outside_canada",
  "qbo_tax_code_public_ticket",
  "stripe_membership_tax_rate_ids",
  "stripe_tax_rate_id_outside_canada",
];

function QboStatusBanner({ searchParams }: { searchParams: Record<string, string> }) {
  if (searchParams.qbo_connected === "true") {
    return (
      <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
        <span>✓</span>
        <span>QuickBooks connected successfully.</span>
      </div>
    );
  }
  if (searchParams.qbo_error) {
    const messages: Record<string, string> = {
      forbidden:             "You don't have permission to connect QuickBooks.",
      state_mismatch:        "OAuth state mismatch — possible CSRF. Please try again.",
      token_exchange_failed: "Failed to exchange the authorization code. Check your Client ID and Secret.",
      missing_credentials:   "QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET is not set.",
      missing_params:        "Intuit returned an incomplete response. Please try again.",
      access_denied:         "Authorization was cancelled.",
      no_refresh_token:      "Intuit didn't return a refresh token. Please try connecting again.",
    };
    return (
      <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
        <span>⚠</span>
        <span>{messages[searchParams.qbo_error] ?? `OAuth error: ${searchParams.qbo_error}`}</span>
      </div>
    );
  }
  return null;
}

export default async function QuickBooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) redirect("/admin/ops");
  const sp = await searchParams;

  const db = createAdminClient();
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

  const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  const isConnected = Boolean(map["qbo_refresh_token"]);

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

  let stripeMembershipTaxRateIds: Array<{ province: string; stripeTaxRateId: string | null }> = [];
  if (map["stripe_membership_tax_rate_ids"]) {
    try {
      const parsed = JSON.parse(map["stripe_membership_tax_rate_ids"]) as Array<{
        province: string;
        stripeTaxRateId: string;
      }>;
      if (Array.isArray(parsed)) {
        stripeMembershipTaxRateIds = parsed.map((m) => ({
          province: m.province,
          stripeTaxRateId: m.stripeTaxRateId,
        }));
      }
    } catch {
      stripeMembershipTaxRateIds = [];
    }
  }

  return (
    <main>
      <AdminPageHeader
        title="QuickBooks Settings"
        description="Maps CSC invoice types to QuickBooks Online items so paid invoices export correctly. Conference commerce (booths, registration, sponsorship) uses per-entity items mapped in the Build tab, and a single tax code set on each conference's Edit page — add-on and other invoice types not listed here use the default item below."
        actions={
          <a
            href="/api/admin/qbo/oauth/initiate"
            className="rounded-md border border-[#2CA01C] bg-white px-3 py-1.5 text-sm font-medium text-[#2CA01C] hover:bg-green-50 transition-colors"
          >
            {isConnected ? "Re-connect QuickBooks" : "Connect QuickBooks"}
          </a>
        }
      />

      <QboStatusBanner searchParams={sp} />

      <div
        className={`mb-6 rounded-xl border p-5 ${
          isConnected ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Connection Status</h2>
        <p className="text-xs text-gray-600">
          {isConnected
            ? "Connected — exports and reconciliation can reach QuickBooks Online. Refresh tokens periodically expire or get revoked (Intuit resets them roughly every 100 days); if Ops Health raises a qbo_oauth_refresh_failure alert, click Re-connect above."
            : "Not connected — no QuickBooks exports or reconciliation will run until you connect. Click Connect QuickBooks above and sign in to authorize CSC's access."}
        </p>
      </div>

      <QBOSettingsForm
        defaultItemId={map["qbo_item_id_default"] || null}
        membershipItemId={map["qbo_item_id_membership"] || null}
        partnershipItemId={map["qbo_item_id_partnership"] || null}
        priceBands={priceBands}
        conferencePartialRefundItemId={map["qbo_item_id_conference_partial_refund"] || null}
        conferenceConnectedBoothItemId={map["qbo_item_id_conference_connected_booth"] || null}
        conferenceExhibitorBoothItemId={map["qbo_item_id_conference_exhibitor_booth"] || null}
        stripeDepositAccountId={map["qbo_stripe_deposit_account_id"] || null}
        membershipTaxCodes={membershipTaxCodes}
        outsideCanadaTaxCode={map["qbo_tax_code_outside_canada"] || null}
        publicTicketTaxCode={map["qbo_tax_code_public_ticket"] || null}
        stripeMembershipTaxRateIds={stripeMembershipTaxRateIds}
        stripeTaxRateIdOutsideCanada={map["stripe_tax_rate_id_outside_canada"] || null}
      />
    </main>
  );
}
