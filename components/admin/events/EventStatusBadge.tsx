"use client";

import type { EventStatus } from "@/lib/events/types";
import { EVENT_STATUS_LABELS } from "@/lib/events/types";

const STATUS_STYLES: Record<EventStatus, string> = {
  pending_review: "bg-amber-100 text-amber-800",
  draft:          "bg-gray-100 text-gray-600",
  published:      "bg-green-100 text-green-700",
  completed:      "bg-blue-100 text-blue-700",
  cancelled:      "bg-red-100 text-red-700",
};

export default function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
      {EVENT_STATUS_LABELS[status]}
    </span>
  );
}
