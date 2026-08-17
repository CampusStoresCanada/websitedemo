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
            <Link
              href="/admin/board"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              ← Board Portal
            </Link>
          </div>
        }
      />

      {!report ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">
            No financial data has been pulled yet. Connect QuickBooks from{" "}
            <Link href="/admin/settings/quickbooks" className="underline">
              QuickBooks Settings
            </Link>{" "}
            first if you haven&apos;t already.
          </p>
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
