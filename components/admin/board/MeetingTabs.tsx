"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export type MeetingTab = "agenda" | "minutes" | "documents" | "financials" | "actions";

const TABS: { key: MeetingTab; label: string }[] = [
  { key: "agenda",     label: "Agenda" },
  { key: "minutes",    label: "Minutes" },
  { key: "documents",  label: "Documents" },
  { key: "financials", label: "Financials" },
  { key: "actions",    label: "Action Items" },
];

interface Props {
  meetingId: string;
}

export default function MeetingTabs({ meetingId: _ }: Props) {
  const searchParams = useSearchParams();
  const active = (searchParams.get("tab") ?? "agenda") as MeetingTab;

  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {TABS.map(tab => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", tab.key);
        return (
          <Link
            key={tab.key}
            href={`?${params.toString()}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              active === tab.key
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
