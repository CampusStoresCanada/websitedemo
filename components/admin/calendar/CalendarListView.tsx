import type { CalendarItemEnriched, CalendarLayer } from "@/lib/calendar/types";
import CalendarItemCard, { isResolved, itemSortRank } from "./CalendarItemCard";

type Props = {
  items: CalendarItemEnriched[];
  activeLayers: Set<CalendarLayer>;
};

/**
 * Urgency rank for a day group — drives the group sort order.
 *   0  has blocked items
 *   1  has critical actionable items
 *   2  has warning actionable items
 *   3  has normal actionable items
 *   4  all done / cancelled (pure history)
 */
function groupUrgencyRank(items: CalendarItemEnriched[]): number {
  const actionable = items.filter((i) => !isResolved(i));
  if (actionable.some((i) => i.status === "blocked"))    return 0;
  if (actionable.some((i) => i.severity === "critical")) return 1;
  if (actionable.some((i) => i.severity === "warning"))  return 2;
  if (actionable.length > 0)                             return 3;
  return 4; // all resolved — pure history
}

function groupByDate(items: CalendarItemEnriched[]): [string, CalendarItemEnriched[]][] {
  const map = new Map<string, CalendarItemEnriched[]>();
  for (const item of items) {
    const key = item.starts_at.slice(0, 10);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }

  // Within each day: blocked → critical → warning → normal → done/cancelled
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      const rankDiff = itemSortRank(a) - itemSortRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.starts_at.localeCompare(b.starts_at);
    });
  }

  // Sort groups: urgency tier first, then by date within each tier.
  // History-only groups sort newest-first (most recent history is more relevant).
  return [...map.entries()].sort(([dateA, itemsA], [dateB, itemsB]) => {
    const rankA = groupUrgencyRank(itemsA);
    const rankB = groupUrgencyRank(itemsB);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === 4) return dateB.localeCompare(dateA); // history: newest first
    return dateA.localeCompare(dateB);                  // actionable: soonest first
  });
}

function formatDateHeading(isoDate: string): string {
  const now      = new Date();
  const today    = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });

  if (isoDate === today)    return "Today";
  if (isoDate === tomorrow) return "Tomorrow";

  return new Date(isoDate + "T12:00:00Z").toLocaleDateString("en-CA", {
    weekday:  "long",
    month:    "long",
    day:      "numeric",
    year:     "numeric",
    timeZone: "America/Toronto",
  });
}

function isPast(isoDate: string): boolean {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  return isoDate < today;
}

/** Worst severity among actionable (non-done, non-cancelled) items in a group. */
function actionableSeverity(items: CalendarItemEnriched[]): "critical" | "warning" | null {
  const actionable = items.filter((i) => !isResolved(i));
  if (actionable.some((i) => i.severity === "critical" || i.status === "blocked")) return "critical";
  if (actionable.some((i) => i.severity === "warning"))  return "warning";
  return null;
}

export default function CalendarListView({ items, activeLayers }: Props) {
  const visible = items.filter((i) => activeLayers.has(i.layer));

  if (visible.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500">
        No items in the selected layers for this window.
      </p>
    );
  }

  const groups = groupByDate(visible);
  const firstHistoryIdx = groups.findIndex(([, g]) => groupUrgencyRank(g) === 4);

  return (
    <div className="space-y-8">
      {groups.map(([date, groupItems], idx) => {
        const worstSeverity = actionableSeverity(groupItems);
        const allResolved   = groupItems.every(isResolved);

        return (
          <div key={date}>
            {/* ── Past divider ── inserted before the first history-only group */}
            {idx === firstHistoryIdx && (
              <div className="flex items-center gap-3 mb-8">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Past
                </span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
            )}

            <section>
              <div className="flex items-center gap-3 mb-3">
                <h2
                  className={`text-sm font-semibold ${
                    allResolved ? "text-gray-400" : "text-gray-700"
                  }`}
                >
                  {formatDateHeading(date)}
                </h2>
                <span className="text-xs text-gray-400">
                  {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                </span>
                {worstSeverity === "critical" && (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    needs attention
                  </span>
                )}
                {worstSeverity === "warning" && (
                  <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                    review soon
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {groupItems.map((item) => (
                  <CalendarItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
