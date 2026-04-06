"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ConferenceSubNavProps {
  conferenceId: string;
  conferenceName: string;
  year: number;
  editionCode: string;
}

/** Config/setup tabs — shown first, left side */
const CONFIG_TABS = [
  { segment: "overview", label: "Overview" },
  { segment: "details", label: "Edit" },
  { segment: "setup", label: "Schedule Design" },
  { segment: "schedule", label: "Schedule" },
  { segment: "products", label: "Products" },
  { segment: "rules", label: "Rules" },
  { segment: "legal", label: "Legal" },
] as const;

/** Registration & commerce management tabs */
const MANAGEMENT_TABS = [
  { segment: "registrations", label: "Registrations" },
  { segment: "wishlist", label: "Wishlist" },
  { segment: "billing-runs", label: "Billing Runs" },
  { segment: "swaps", label: "Swaps" },
  { segment: "status", label: "Status" },
] as const;

/**
 * Conference-day ops tabs.
 * These were previously buried as small header buttons — promoted to first-class tabs.
 */
const OPS_TABS = [
  { segment: "war-room", label: "War Room" },
  { segment: "badges", label: "Badge Ops" },
  { segment: "schedule-ops", label: "Schedule Ops" },
  { segment: "travel-import", label: "Travel Import" },
] as const;

export default function ConferenceSubNav({
  conferenceId,
  conferenceName,
  year,
  editionCode,
}: ConferenceSubNavProps) {
  const pathname = usePathname();
  const basePath = `/admin/conference/${conferenceId}`;

  function isActive(segment: string): boolean {
    return (
      pathname === `${basePath}/${segment}` ||
      // Overview is also active when at the bare base path (pre-redirect)
      (segment === "overview" && pathname === basePath)
    );
  }

  function tabClass(segment: string): string {
    return `whitespace-nowrap py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
      isActive(segment)
        ? "border-[#EE2A2E] text-[#EE2A2E]"
        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
    }`;
  }

  return (
    <div className="mb-6">
      {/* Conference header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{conferenceName}</h1>
          <p className="text-sm text-gray-500">
            {year} &middot; Edition {editionCode}
          </p>
        </div>
        {/* Check-in Desk stays as a standalone button — it opens a new window */}
        <Link
          href={`${basePath}/check-in`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-[#EE2A2E] bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] shrink-0"
        >
          Check-in Desk ↗
        </Link>
      </div>

      {/* Unified tab bar */}
      <div className="border-b border-gray-200">
        <nav
          className="-mb-px flex items-center gap-4 overflow-x-auto"
          aria-label="Conference sections"
        >
          {/* Group 1: Config & setup */}
          {CONFIG_TABS.map((item) => (
            <Link
              key={item.segment}
              href={`${basePath}/${item.segment}`}
              className={tabClass(item.segment)}
            >
              {item.label}
            </Link>
          ))}

          {/* Visual separator */}
          <span className="h-4 w-px shrink-0 bg-gray-300" aria-hidden="true" />

          {/* Group 2: Registration & commerce management */}
          {MANAGEMENT_TABS.map((item) => (
            <Link
              key={item.segment}
              href={`${basePath}/${item.segment}`}
              className={tabClass(item.segment)}
            >
              {item.label}
            </Link>
          ))}

          {/* Visual separator */}
          <span className="h-4 w-px shrink-0 bg-gray-300" aria-hidden="true" />

          {/* Group 3: Conference-day operations */}
          {OPS_TABS.map((item) => (
            <Link
              key={item.segment}
              href={`${basePath}/${item.segment}`}
              className={tabClass(item.segment)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
