"use client";

import type { PendingContentChange } from "@/lib/types/db";
import { fieldDisplayLabel } from "@/lib/editable-fields";

interface MyPendingChangesProps {
  changes: PendingContentChange[];
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(
    iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z"
  ).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  approved: "bg-emerald-100 text-emerald-700",
  expired: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting approval",
  rejected: "Rejected",
  approved: "Approved",
  expired: "Expired",
};

export default function MyPendingChanges({ changes }: MyPendingChangesProps) {
  if (changes.length === 0) {
    return (
      <p className="mt-2 text-sm text-gray-500">No content changes submitted in the last 30 days.</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {changes.map((change) => {
        const statusStyle = STATUS_STYLES[change.status] ?? STATUS_STYLES.pending;
        const statusLabel = STATUS_LABELS[change.status] ?? change.status;
        const isRejected = change.status === "rejected";

        return (
          <div
            key={change.id}
            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-[#4A4A4A] bg-gray-200 px-1.5 py-0.5 rounded flex-shrink-0">
                  {change.target_table}
                </span>
                <span className="font-medium text-[#1A1A1A] truncate">
                  {change.field_display_label ?? fieldDisplayLabel(change.target_column)}
                </span>
                {change.entity_display_name && (
                  <span className="text-gray-500 truncate hidden sm:inline">
                    — {change.entity_display_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusStyle}`}>
                  {statusLabel}
                </span>
                <span className="text-xs text-gray-400">{relativeTime(change.requested_at)}</span>
              </div>
            </div>

            {/* Proposed value preview */}
            <div className="mt-1.5 text-xs text-gray-500">
              <span className="text-gray-400">Proposed: </span>
              <span className="text-gray-700">
                {change.proposed_value !== null && change.proposed_value !== undefined
                  ? String(change.proposed_value).slice(0, 120) + (String(change.proposed_value).length > 120 ? "…" : "")
                  : <em>empty</em>}
              </span>
            </div>

            {/* Rejection note */}
            {isRejected && change.review_note && (
              <div className="mt-1.5 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                <span className="font-medium">Reviewer note: </span>{change.review_note}
              </div>
            )}

            {/* Link to page */}
            {change.page_href && (
              <a
                href={change.page_href}
                className="mt-1.5 inline-block text-xs text-[#EE2A2E] hover:underline"
              >
                View page ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
