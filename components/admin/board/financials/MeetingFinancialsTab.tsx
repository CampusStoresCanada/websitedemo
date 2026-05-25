"use client";

import { useState } from "react";
import type { ComparativeReport } from "@/lib/quickbooks/types";
import IncomeStatementTable from "./IncomeStatementTable";
import BalanceSheetTable from "./BalanceSheetTable";

interface Props {
  report:       ComparativeReport | null;
  reportPeriod: { start: string; end: string; label: string };
  meetingId:    string;
  isSA:         boolean;
}

const TABS = [
  { key: "income",  label: "Income Statement" },
  { key: "balance", label: "Balance Sheet" },
];

export default function MeetingFinancialsTab({
  report,
  reportPeriod,
  meetingId,
  isSA,
}: Props) {
  const [activeTab, setActiveTab] = useState<"income" | "balance">("income");

  return (
    <div className="mb-8">
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Financial Report</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Frozen as of {reportPeriod.label} ({reportPeriod.end})
            — last closed month before this meeting
          </p>
        </div>
        {report && (
          <span className="text-xs text-gray-400">
            Pulled {new Date(report.pulledAt).toLocaleDateString("en-CA")}
          </span>
        )}
      </div>

      {!report ? (
        /* ── Not yet pulled ── */
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
          <div className="text-2xl mb-2">📊</div>
          <p className="text-sm font-medium text-gray-700">No financial report for this meeting yet</p>
          <p className="mt-1 text-xs text-gray-400">
            This report will cover{" "}
            <span className="font-medium text-gray-600">
              {reportPeriod.start} → {reportPeriod.end}
            </span>{" "}
            ({reportPeriod.label})
          </p>
          {isSA && (
            <p className="mt-3 text-xs text-gray-400">
              Use the <strong>Pull Meeting Financials</strong> button above to generate it.
            </p>
          )}
        </div>
      ) : (
        /* ── Report exists ── */
        <>
          {/* Tab strip */}
          <div className="flex gap-1 border-b border-gray-200 mb-4">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as "income" | "balance")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.key
                    ? "border-[#163D6D] text-[#163D6D]"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "income" && <IncomeStatementTable report={report} />}
          {activeTab === "balance" && (
            <BalanceSheetTable
              data={report.balanceSheet}
              asOf={report.asOfDate}
              pulledAt={report.pulledAt}
            />
          )}
        </>
      )}
    </div>
  );
}
