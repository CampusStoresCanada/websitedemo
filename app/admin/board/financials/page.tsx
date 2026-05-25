/**
 * /admin/board/financials — Financial reporting dashboard
 *
 * Tabbed view: Comparative Income Statement | Balance Sheet
 * Data pulled from QBO and cached in board_qbo_snapshots.
 * Super admins can pull fresh reports.
 */

import Link from "next/link";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { getLatestComparativeReport } from "@/lib/quickbooks/reports";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PullFinancialsButton from "@/components/admin/board/PullFinancialsButton";
import IncomeStatementTable from "@/components/admin/board/financials/IncomeStatementTable";
import BalanceSheetTable from "@/components/admin/board/financials/BalanceSheetTable";
import FinancialsTabs from "@/components/admin/board/financials/FinancialsTabs";

export const metadata = {
  title: "Financials | Board Portal | Admin | Campus Stores Canada",
};

export const dynamic   = "force-dynamic";
export const revalidate = 0;

function QboStatusBanner({ searchParams }: { searchParams: Record<string, string> }) {
  if (searchParams.qbo_connected === "true") {
    return (
      <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
        <span>✓</span>
        <span>QuickBooks connected successfully. Pull a report to populate the dashboard.</span>
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

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const auth  = await requireAdmin();
  const isSA  = auth.ok && isSuperAdmin(auth.ctx.globalRole);
  const sp    = await searchParams;
  const tab   = sp.tab ?? "income";

  const report = await getLatestComparativeReport();

  return (
    <main>
      <AdminPageHeader
        title="Financial Reports"
        description="QuickBooks Online comparative income statement and balance sheet."
        actions={
          <div className="flex items-center gap-2">
            {isSA && <PullFinancialsButton />}
            {isSA && (
              <a
                href="/api/admin/qbo/oauth/initiate"
                className="rounded-md border border-[#2CA01C] bg-white px-3 py-1.5 text-sm font-medium text-[#2CA01C] hover:bg-green-50 transition-colors"
              >
                {report ? "Re-connect QuickBooks" : "Connect QuickBooks"}
              </a>
            )}
            <Link
              href="/admin/board"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              ← Board Portal
            </Link>
          </div>
        }
      />

      <QboStatusBanner searchParams={sp} />

      {!report ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">No financial data has been pulled yet.</p>
          {isSA && (
            <p className="mt-2 text-xs text-gray-400">
              Click <strong>Pull QBO Reports</strong> above to fetch the latest data from QuickBooks.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Tab navigation */}
          <FinancialsTabs activeTab={tab} />

          {/* Tab content */}
          <div className="mt-4">
            {tab === "income" && (
              <IncomeStatementTable report={report} />
            )}
            {tab === "balance" && (
              <BalanceSheetTable
                data={report.balanceSheet}
                asOf={report.asOfDate}
                pulledAt={report.pulledAt}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
