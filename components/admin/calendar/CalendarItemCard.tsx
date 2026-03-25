import Link from "next/link";
import { parseUTC } from "@/lib/utils";
import type { CalendarItemEnriched } from "@/lib/calendar/types";

// ── Helpers ───────────────────────────────────────────────────────

/** Items that no longer need human attention — sink to bottom, render muted. */
export function isResolved(item: CalendarItemEnriched): boolean {
  return item.status === "done" || item.status === "cancelled";
}

/**
 * Sort rank within a day group.
 *   0  blocked           — needs human action, date-independent
 *   1  critical planned/active
 *   2  warning  planned/active
 *   3  normal   planned/active
 *   10 done / cancelled  — history, sinks to bottom
 */
export function itemSortRank(item: CalendarItemEnriched): number {
  if (item.status === "blocked")                             return 0;
  if (item.status === "done" || item.status === "cancelled") return 10;
  const sev: Record<string, number> = { critical: 1, warning: 2, normal: 3 };
  return sev[item.severity] ?? 3;
}

// ── Severity badge (only shown on actionable items) ───────────────

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border border-red-200",
  warning:  "bg-yellow-100 text-yellow-700 border border-yellow-200",
  normal:   "bg-gray-100 text-gray-500 border border-gray-200",
};

const STATUS_STYLES: Record<string, string> = {
  blocked:   "bg-red-50 text-red-700",
  active:    "bg-blue-50 text-blue-700",
  done:      "bg-green-50 text-green-600",
  cancelled: "bg-gray-50 text-gray-400",
  planned:   "bg-gray-50 text-gray-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  conference:       "Conference",
  membership:       "Membership",
  renewals_billing: "Renewals",
  legal_retention:  "Legal",
  communications:   "Comms",
  integrations_ops: "Ops",
};

const LAYER_DOT: Record<string, string> = {
  people:     "bg-blue-400",
  admin_ops:  "bg-purple-400",
  system_ops: "bg-orange-400",
};

// ── Relative time label ────────────────────────────────────────────

function relativeLabel(isoDate: string): string {
  const now    = Date.now();
  const ts     = new Date(isoDate).getTime();
  const diffMs = ts - now;
  const abs    = Math.abs(diffMs);
  const days   = Math.floor(abs / (1000 * 60 * 60 * 24));
  const hours  = Math.floor(abs / (1000 * 60 * 60));

  if (diffMs < 0) {
    if (days === 0) return "today (past)";
    return `${days}d ago`;
  }
  if (hours < 24) return `in ${hours}h`;
  if (days === 1)  return "tomorrow";
  return `in ${days}d`;
}

// ── Component ─────────────────────────────────────────────────────

type Props = {
  item: CalendarItemEnriched;
  /** Compact mode: used inside the calendar grid cells. */
  compact?: boolean;
};

export default function CalendarItemCard({ item, compact = false }: Props) {
  const resolved      = isResolved(item);
  const severityStyle = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.normal;
  const statusStyle   = STATUS_STYLES[item.status]     ?? STATUS_STYLES.planned;
  const layerDot      = LAYER_DOT[item.layer]          ?? "bg-gray-300";
  const catLabel      = CATEGORY_LABELS[item.category] ?? item.category;
  const relTime       = relativeLabel(item.starts_at);

  const dateStr = parseUTC(item.starts_at).toLocaleDateString("en-CA", {
    month:    "short",
    day:      "numeric",
    timeZone: "America/Toronto",
  });

  // ── Compact (grid cell) ──────────────────────────────────────────
  if (compact) {
    // Resolved items: flat grey pill
    if (resolved) {
      return (
        <Link
          href={`/admin/calendar/${item.id}`}
          className="block truncate rounded px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 hover:bg-gray-200 transition-colors"
          title={item.title}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-gray-300" />
          {item.title}
        </Link>
      );
    }
    return (
      <Link
        href={`/admin/calendar/${item.id}`}
        className={`block truncate rounded px-1.5 py-0.5 text-xs font-medium hover:opacity-80 ${severityStyle}`}
        title={item.title}
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${layerDot}`} />
        {item.title}
      </Link>
    );
  }

  // ── Full card ────────────────────────────────────────────────────

  // Resolved: muted, no severity badge, lighter border
  if (resolved) {
    return (
      <Link
        href={`/admin/calendar/${item.id}`}
        className="block rounded-xl border border-gray-100 bg-gray-50/60 p-4 hover:border-gray-200 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-gray-300" />
            <span className="text-xs text-gray-400 flex-shrink-0">{catLabel}</span>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${statusStyle}`}>
            {item.status}
          </span>
        </div>

        <h3 className="mt-2 text-sm font-medium text-gray-400 leading-snug">
          {item.title}
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
          <span>{dateStr}</span>
          <span>{relTime}</span>
          {item.notes_count > 0 && (
            <span>{item.notes_count} note{item.notes_count > 1 ? "s" : ""}</span>
          )}
        </div>
      </Link>
    );
  }

  // Blocked: red left-border accent to make it unmissable
  const blockedAccent = item.status === "blocked"
    ? "border-l-4 border-l-red-500 pl-3"
    : "";

  return (
    <Link
      href={`/admin/calendar/${item.id}`}
      className={`block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors ${blockedAccent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${layerDot}`} />
          <span className="text-xs text-gray-500 flex-shrink-0">{catLabel}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityStyle}`}>
            {item.severity}
          </span>
        </div>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${statusStyle}`}>
          {item.status}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-gray-900 leading-snug">
        {item.title}
      </h3>

      {item.description && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{item.description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>{dateStr}</span>
        <span className={
          item.severity === "critical" ? "font-semibold text-red-600" :
          item.severity === "warning"  ? "font-medium text-yellow-600" : ""
        }>
          {relTime}
        </span>
        {item.owner_name && (
          <span className="truncate">Owner: {item.owner_name}</span>
        )}
        {item.notes_count > 0 && (
          <span>{item.notes_count} note{item.notes_count > 1 ? "s" : ""}</span>
        )}
        {item.source_mode === "projected" && (
          <span className="text-gray-400 italic">projected</span>
        )}
        {item.requires_confirmation && !item.confirmed_at && !isResolved(item) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 border border-orange-200">
            ⚠ Awaiting confirmation
          </span>
        )}
        {item.requires_confirmation && item.confirmed_at && !isResolved(item) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            ✓ Confirmed
          </span>
        )}
      </div>
    </Link>
  );
}
