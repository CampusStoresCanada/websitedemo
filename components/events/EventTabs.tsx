"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

interface EventTabsProps {
  upcomingCount: number;
  pastCount: number;
  activeTab: "upcoming" | "past";
}

export default function EventTabs({ upcomingCount, pastCount, activeTab }: EventTabsProps) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const setTab = useCallback(
    (tab: "upcoming" | "past") => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "upcoming") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    },
    [router, pathname, searchParams]
  );

  const tabs = [
    { key: "upcoming" as const, label: "Upcoming", count: upcomingCount },
    { key: "past"     as const, label: "Past",     count: pastCount     },
  ];

  return (
    <div className="flex gap-1 border-b border-white/20">
      {tabs.map(({ key, label, count }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
              isActive
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/90"
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? "bg-white/20 text-white" : "bg-white/10 text-white/60"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
