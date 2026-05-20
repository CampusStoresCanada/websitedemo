"use client";

import type { SponsorAgreementStatus } from "@/lib/sponsorship/types";

const STYLES: Record<SponsorAgreementStatus, string> = {
  draft:     "bg-gray-100 text-gray-600",
  active:    "bg-green-100 text-green-700",
  expired:   "bg-blue-100 text-blue-600",
  cancelled: "bg-red-100 text-red-600",
};

const LABELS: Record<SponsorAgreementStatus, string> = {
  draft:     "Draft",
  active:    "Active",
  expired:   "Expired",
  cancelled: "Cancelled",
};

export default function SponsorStatusBadge({ status }: { status: SponsorAgreementStatus }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
