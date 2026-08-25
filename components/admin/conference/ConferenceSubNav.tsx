"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ConferenceSubNavProps {
  conferenceId: string;
  conferenceName: string;
  year: number;
  editionCode: string;
}

type Tab = { segment: string; label: string };

/**
 * Four-stage IA: Describe → Package → Sell → Fulfill. The existing tab pages
 * survive as deep links, grouped under the stage they belong to so the admin
 * sees one linear path. Overview is the home/launch-checklist.
 * See docs/CONFERENCE_V2_BLUEPRINT.md.
 */
const STAGES: Array<{ label: string; tabs: Tab[] }> = [
  {
    label: "Describe",
    tabs: [
      { segment: "details", label: "Edit" },
      { segment: "describe", label: "Days & Setup" },
      { segment: "build", label: "Catalog" },
      { segment: "floor-plan", label: "Floor Plan" },
      { segment: "schedule", label: "Schedule" },
      { segment: "hotel", label: "Hotel" },
      { segment: "documents", label: "Documents" },
    ],
  },
  {
    label: "Sell",
    tabs: [
      { segment: "legal", label: "Legal" },
      { segment: "status", label: "Status" },
    ],
  },
  {
    label: "Fulfill",
    tabs: [
      { segment: "registrations", label: "Registrations" },
      { segment: "comms", label: "Comms" },
      { segment: "checklists", label: "Checklists" },
      { segment: "swaps", label: "Swaps" },
      { segment: "war-room", label: "War Room" },
      { segment: "badges", label: "Badge Ops" },
      { segment: "schedule-ops", label: "Schedule Ops" },
      { segment: "travel-import", label: "Travel Import" },
    ],
  },
];

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
      (segment === "overview" && pathname === basePath)
    );
  }

  function tabClass(segment: string): string {
    return `whitespace-nowrap py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
      isActive(segment)
        ? "border-accent text-accent"
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
        <Link
          href={`${basePath}/check-in`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover shrink-0"
        >
          Check-in Desk ↗
        </Link>
      </div>

      {/* Overview / launch checklist — the home */}
      <div className="mb-3">
        <Link
          href={`${basePath}/overview`}
          className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ${
            isActive("overview")
              ? "bg-accent text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Overview &amp; Launch Checklist
        </Link>
      </div>

      {/* Four-stage tab bar */}
      <div className="border-b border-gray-200">
        <nav
          className="-mb-px flex items-end gap-5 overflow-x-auto pb-px"
          aria-label="Conference stages"
        >
          {STAGES.map((stage, index) => (
            <div key={stage.label} className="flex items-end gap-4">
              <div className="flex flex-col">
                <span className="mb-1 flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-[9px] text-gray-500">
                    {index + 1}
                  </span>
                  {stage.label}
                </span>
                <div className="flex items-center gap-4">
                  {stage.tabs.map((tab) => (
                    <Link key={tab.segment} href={`${basePath}/${tab.segment}`} className={tabClass(tab.segment)}>
                      {tab.label}
                    </Link>
                  ))}
                </div>
              </div>
              {index < STAGES.length - 1 && (
                <span className="mb-2 h-6 w-px shrink-0 bg-gray-200" aria-hidden="true" />
              )}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
