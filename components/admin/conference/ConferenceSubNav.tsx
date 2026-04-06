"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ConferenceSubNavProps {
  conferenceId: string;
  conferenceName: string;
  year: number;
  editionCode: string;
}

const NAV_ITEMS = [
  { segment: "details", label: "Details" },
  { segment: "overview", label: "Overview" },
  { segment: "setup", label: "Setup" },
  { segment: "schedule", label: "Schedule" },
  { segment: "products", label: "Products" },
  { segment: "rules", label: "Rules" },
  { segment: "registrations", label: "Registrations" },
  { segment: "legal", label: "Legal" },
  { segment: "wishlist", label: "Wishlist" },
  { segment: "billing-runs", label: "Billing Runs" },
  { segment: "swaps", label: "Swaps" },
  { segment: "status", label: "Status" },
] as const;

const OPS_LINKS = [
  { segment: "war-room", label: "War Room" },
  { segment: "badges", label: "Badge Ops" },
  { segment: "check-in", label: "Check-in Desk", external: true },
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

  // Match: exact base path maps to "details", otherwise match last segment
  function isActive(segment: string): boolean {
    if (segment === "details") {
      return pathname === basePath || pathname === `${basePath}/details`;
    }
    return pathname === `${basePath}/${segment}`;
  }

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{conferenceName}</h1>
          <p className="text-sm text-gray-500">
            {year} &middot; Edition {editionCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {OPS_LINKS.map((link) => (
            <Link
              key={link.segment}
              href={`${basePath}/${link.segment}`}
              {...("external" in link && link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                link.segment === "check-in"
                  ? "border-[#EE2A2E] bg-[#EE2A2E] text-white hover:bg-[#b50001]"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4 overflow-x-auto" aria-label="Conference sections">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.segment}
              href={item.segment === "details" ? basePath : `${basePath}/${item.segment}`}
              className={`whitespace-nowrap py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                isActive(item.segment)
                  ? "border-[#EE2A2E] text-[#EE2A2E]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
