import type { CalendarItemEnriched, CalendarLayer, DaySaturation } from "@/lib/calendar/types";
import CalendarItemCard, { isResolved, itemSortRank } from "./CalendarItemCard";

type Props = {
  items: CalendarItemEnriched[];
  activeLayers: Set<CalendarLayer>;
  saturation: DaySaturation[];
  /** YYYY-MM — the month to render. */
  month: string;
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  // 0 = Sun, adjust to Mon = 0 for grid.
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

export default function CalendarGridView({
  items,
  activeLayers,
  saturation,
  month,
}: Props) {
  const [yearStr, monthStr] = month.split("-");
  const year  = parseInt(yearStr, 10);
  const monthN = parseInt(monthStr, 10);

  const totalDays    = daysInMonth(year, monthN);
  const leadingBlanks = firstDayOfWeek(year, monthN);
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

  // Build a map of date → items (sorted: blocked → critical → warning → normal → done/cancelled)
  const byDate = new Map<string, CalendarItemEnriched[]>();
  for (const item of items) {
    if (!activeLayers.has(item.layer)) continue;
    const key = item.starts_at.slice(0, 10);
    const [y, m] = key.split("-");
    if (parseInt(y, 10) !== year || parseInt(m, 10) !== monthN) continue;
    const arr = byDate.get(key);
    if (arr) arr.push(item);
    else byDate.set(key, [item]);
  }
  for (const [, arr] of byDate) {
    arr.sort((a, b) => {
      const rankDiff = itemSortRank(a) - itemSortRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.starts_at.localeCompare(b.starts_at);
    });
  }

  const satMap = new Map<string, DaySaturation>(saturation.map((s) => [s.date, s]));

  const DAYS_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Build cell array: null for blanks, date-string for actual days.
  const cells: (string | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(monthN).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }),
  ];
  // Pad to complete last row.
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 mb-0">
        {DAYS_HEADER.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-gray-500">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 border-l border-t border-gray-200">
        {cells.map((dateStr, idx) => {
          if (!dateStr) {
            return (
              <div
                key={`blank-${idx}`}
                className="min-h-[100px] border-b border-r border-gray-100 bg-gray-50/50"
              />
            );
          }

          const dayItems   = byDate.get(dateStr) ?? [];
          const sat        = satMap.get(dateStr);
          const isToday    = dateStr === todayStr;
          const isPast     = dateStr < todayStr;
          // Severity dots only reflect actionable items — resolved items don't drive alerts
          const actionable = dayItems.filter((i) => !isResolved(i));
          const hasCtical  = actionable.some((i) => i.severity === "critical" || i.status === "blocked");
          const hasWarn    = !hasCtical && actionable.some((i) => i.severity === "warning");
          const dayNum    = parseInt(dateStr.slice(8), 10);

          return (
            <div
              key={dateStr}
              className={`min-h-[100px] border-b border-r border-gray-200 p-1.5 flex flex-col gap-1 ${
                isPast ? "bg-gray-50/60" : "bg-white"
              } ${sat?.overloaded ? "ring-1 ring-inset ring-yellow-300" : ""}`}
            >
              {/* Day number */}
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday
                      ? "bg-blue-600 text-white"
                      : isPast
                      ? "text-gray-400"
                      : "text-gray-700"
                  }`}
                >
                  {dayNum}
                </span>
                {/* Severity dot for the day */}
                {hasCtical && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Critical item" />
                )}
                {hasWarn && (
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" title="Warning item" />
                )}
              </div>

              {/* Items — show up to 3, then overflow count */}
              {dayItems.slice(0, 3).map((item) => (
                <CalendarItemCard key={item.id} item={item} compact />
              ))}
              {dayItems.length > 3 && (
                <span className="text-xs text-gray-400 pl-1">
                  +{dayItems.length - 3} more
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
