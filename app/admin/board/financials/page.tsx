/**
 * /admin/board/financials  — Financial reporting dashboard
 *
 * Shows latest QBO snapshot with key figures.
 * Super admins can pull fresh reports and see snapshot history.
 */

import Link from "next/link";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLatestFinancialSummary } from "@/lib/quickbooks/reports";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PullFinancialsButton from "@/components/admin/board/PullFinancialsButton";
import type { QBFinancialSummary } from "@/lib/quickbooks/types";

export const metadata = {
  title: "Financials | Board Portal | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
}) {
  const isPositive = value !== null && value >= 0;
  const colorClass =
    value === null
      ? "text-gray-300"
      : accent
        ? isPositive
          ? "text-green-600"
          : "text-red-600"
        : "text-gray-900";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{fmt(value)}</div>
    </div>
  );
}

type SnapshotRow = {
  id: string;
  period_end_date: string;
  pulled_at: string;
  report_type: string;
  data_json: unknown;
  approved_by: string | null;
};

function QboStatusBanner({ searchParams }: { searchParams: Record<string, string> }) {
  if (searchParams.qbo_connected === "true") {
    return (
      <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
        <span>✓</span>
        <span>QuickBooks connected successfully. You can now pull financial reports.</span>
      </div>
    );
  }
  if (searchParams.qbo_error) {
    const messages: Record<string, string> = {
      forbidden:           "You don't have permission to connect QuickBooks.",
      state_mismatch:      "OAuth state mismatch — possible CSRF. Please try again.",
      token_exchange_failed: "Failed to exchange the authorization code. Check your Client ID and Secret.",
      missing_credentials: "QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET is not set.",
      missing_params:      "Intuit returned an incomplete response. Please try again.",
      access_denied:       "Authorization was cancelled.",
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
  const auth = await requireAdmin();
  const isSA = auth.ok && isSuperAdmin(auth.ctx.globalRole);
  const sp = await searchParams;

  const db = createAdminClient();

  const [latest, historyRes] = await Promise.all([
    getLatestFinancialSummary(),
    isSA
      ? db
          .from("board_qbo_snapshots")
          .select("id, period_end_date, pulled_at, report_type, data_json, approved_by")
          .order("pulled_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
  ]);

  const history: SnapshotRow[] = (historyRes.data as SnapshotRow[] | null) ?? [];

  return (
    <main>
      <AdminPageHeader
        title="Financial Reports"
        description="QuickBooks Online P&L and Balance Sheet data."
        actions={
          <div className="flex items-center gap-2">
            {isSA && <PullFinancialsButton />}
            {isSA && (
              <a
                href="/api/admin/qbo/oauth/initiate"
                className="rounded-md border border-[#2CA01C] bg-white px-3 py-1.5 text-sm font-medium text-[#2CA01C] hover:bg-green-50 transition-colors"
              >
                {latest ? "Re-connect QuickBooks" : "Connect QuickBooks"}
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

      {latest ? (
        <>
          {/* Period header */}
          <p className="mb-4 text-sm text-gray-500">
            Reporting period:{" "}
            <span className="font-medium text-gray-900">
              {latest.periodStart} → {latest.periodEnd}
            </span>
            <span className="ml-3 text-gray-400">
              Pulled {new Date(latest.reportPulledAt).toLocaleDateString("en-CA")}
            </span>
          </p>

          {/* P&L metrics */}
          <div className="mb-3">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Income Statement
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label="Total Revenue"  value={latest.totalRevenue} />
              <MetricCard label="Total Expenses" value={latest.totalExpenses} />
              <MetricCard label="Net Income"     value={latest.netIncome} accent />
            </div>
          </div>

          {/* Balance sheet metrics */}
          <div className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Balance Sheet
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label="Cash on Hand"        value={latest.cashOnHand} />
              <MetricCard label="Accounts Receivable" value={latest.accountsReceivable} />
              <MetricCard label="Total Assets"        value={latest.totalAssets} />
            </div>
          </div>
        </>
      ) : (
        <div className="mb-8 rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">No financial data has been pulled yet.</p>
          {isSA && (
            <p className="mt-2 text-xs text-gray-400">
              First, click <strong>Connect QuickBooks</strong> above to authorise, then <strong>Pull QBO Reports</strong>.
            </p>
          )}
        </div>
      )}

      {/* Snapshot history — super admin only */}
      {isSA && history.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Pull History
          </h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Period End</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Pulled At</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Net Income</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Revenue</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((row) => {
                  const d = (row.data_json ?? {}) as Partial<QBFinancialSummary>;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{row.period_end_date}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(row.pulled_at).toLocaleDateString("en-CA")}
                      </td>
                      <td className={`px-4 py-3 font-medium ${
                        d.netIncome === undefined || d.netIncome === null ? "text-gray-300" :
                        d.netIncome >= 0 ? "text-green-600" : "text-red-600"
                      }`}>
                        {fmt(d.netIncome ?? null)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{fmt(d.totalRevenue ?? null)}</td>
                      <td className="px-4 py-3 text-gray-600">{fmt(d.cashOnHand ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
