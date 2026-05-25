"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TABS = [
  { key: "income",  label: "Income Statement" },
  { key: "balance", label: "Balance Sheet" },
];

export default function FinancialsTabs({ activeTab }: { activeTab: string }) {
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-0">
      {TABS.map(tab => {
        const isActive = activeTab === tab.key;
        return (
          <Link
            key={tab.key}
            href={`?tab=${tab.key}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? "border-[#163D6D] text-[#163D6D]"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
