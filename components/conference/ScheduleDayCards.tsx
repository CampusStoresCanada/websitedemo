import Link from "next/link";

/**
 * Pure rendering block for a day-grouped schedule — extracted out of
 * ScheduleAtAGlance.tsx so any page can feed it real timeline data (filtered
 * however fits that context: by audience track, or by exactly what one
 * specific offer includes) without re-implementing the day-card markup.
 */

export type ScheduleBlockItem = {
  id: string;
  kind: string;
  title: string;
  startsAtLocal: string;
  endsAtLocal: string;
  locationLabel: string | null;
  dayKeyLocal: string;
};

// Trade Show Tuesday is the curated-meetings day, not open floor time like
// Wed/Thu — give it its own label rather than folding it into "trade show"
// generically.
const MEETING_DAY_ID = "1f1553a4-0b30-4db3-9f36-28af622cf54c";
// Shares Thursday with Trade Show Thursday (also kind: session) — needs its
// own label so the two don't both render as "Trade show floor".
const COURSE_MATERIALS_UNCONFERENCE_ID = "5752d511-1a55-4c14-9b38-9b8e8b565c2b";
// Tuesday-morning warm-up blocks — also kind: session (for schedule-geometry
// reasons), but not trade-show-floor content at all.
const SESSION_LABEL_OVERRIDES: Record<string, string> = {
  "460536bc-1eb8-4af5-85ea-3572dc34f988": "Opening session", // Opening Session
  "2a9f1490-fba4-4074-9b8b-118f3790b7d9": "Before speed pitches", // Meetings Intro
};
const KIND_LABEL: Record<string, string> = {
  session: "Trade show floor",
  event: "Event",
  meeting: "Meeting",
};

export function kindLabelFor(item: { id: string; kind: string }): string {
  if (item.id === MEETING_DAY_ID) return "Curated partner meetings";
  if (item.id === COURSE_MATERIALS_UNCONFERENCE_ID) return "Course Materials Unconference";
  if (SESSION_LABEL_OVERRIDES[item.id]) return SESSION_LABEL_OVERRIDES[item.id];
  return KIND_LABEL[item.kind] ?? item.kind;
}

export function formatDayHeading(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function groupByDay(items: ScheduleBlockItem[]): { dayKeys: string[]; byDay: Map<string, ScheduleBlockItem[]> } {
  const dayKeys = [...new Set(items.map((item) => item.dayKeyLocal))].sort();
  const byDay = new Map(dayKeys.map((key) => [key, items.filter((item) => item.dayKeyLocal === key)]));
  return { dayKeys, byDay };
}

export default function ScheduleDayCards({
  heading,
  subheading,
  dayKeys,
  byDay,
  rsvpSlugByEntityId,
  tierTagFor,
  legend,
}: {
  /** Omit both when embedding inline under content that already names the day/pass — avoids a redundant header. */
  heading?: string;
  subheading?: string;
  dayKeys: string[];
  byDay: Map<string, ScheduleBlockItem[]>;
  rsvpSlugByEntityId?: Map<string, string>;
  /** Colour-tags an item by which tier unlocks it (used by the undecided-partner "which level?" view). */
  tierTagFor?: (itemId: string) => { label: string; color: string } | null;
  legend?: React.ReactNode;
}) {
  if (dayKeys.length === 0) return null;

  return (
    <section>
      {(heading || subheading || legend) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {heading && <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">{heading}</h2>}
            {subheading && <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">{subheading}</p>}
          </div>
          {legend}
        </div>
      )}

      {/* Fixed-width, wrapping cards rather than a grid keyed to viewport
          breakpoints — a grid's column count depends on the *screen* width,
          so a single day (e.g. one Day Pass's schedule) nested in a narrow
          container still got sized as "1 of 4 columns" and rendered as a
          sliver. A fixed width sizes each card the same regardless of how
          many days exist or how wide the surrounding container is. */}
      <div className={`flex flex-wrap gap-4 ${heading || subheading || legend ? "mt-6" : ""}`}>
        {dayKeys.map((dayKey) => (
          <div key={dayKey} className="flex w-full flex-col rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-sm sm:w-64">
            <h3 className="text-sm font-bold text-[#1A1A1A]">{formatDayHeading(dayKey)}</h3>
            <ul className="mt-3 space-y-3">
              {(byDay.get(dayKey) ?? []).map((item) => {
                const tag = tierTagFor?.(item.id) ?? null;
                const rsvpSlug = rsvpSlugByEntityId?.get(item.id);
                return (
                  <li key={item.id} className={tag ? "border-l-4 pl-3" : ""} style={tag ? { borderColor: tag.color } : undefined}>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#6B6B6B]">
                      {kindLabelFor(item)}
                      {tag && (
                        <span className="ml-1.5 font-semibold" style={{ color: tag.color }}>
                          · {tag.label}
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-semibold text-[#1A1A1A]">{item.title}</p>
                    <p className="text-xs text-[#6B6B6B]">
                      {item.startsAtLocal}
                      {item.endsAtLocal ? ` – ${item.endsAtLocal}` : ""}
                      {item.locationLabel ? ` · ${item.locationLabel}` : ""}
                    </p>
                    {rsvpSlug && (
                      <Link href={`/events/${rsvpSlug}`} className="mt-1 inline-block text-xs font-medium text-[#EE2A2E] hover:underline">
                        RSVP →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
