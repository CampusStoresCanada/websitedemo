/**
 * Recurring board action items.
 *
 * Recurrence is **completion-triggered, never clock-triggered**: the next
 * instance appears when the current one is ticked. That matters because
 * recurrence multiplies whatever it is fed — put a task nobody does on a
 * monthly timer and a year of neglect produces twelve zombies instead of one.
 *
 * With completion as the trigger, a series can only ever have one open
 * instance. If the work stops happening the series quietly stops, and that
 * silence is the signal; the stale instance ages and escalation catches it at
 * three meetings.
 *
 * See docs/BOARD_ACTION_ITEM_MINT.md §11.
 */

export const RECURRENCES = ["each_meeting", "monthly", "quarterly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  each_meeting: "Every board meeting",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && (RECURRENCES as readonly string[]).includes(value);
}

function addMonths(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  // Day 31 in a 30-day month would roll into the next one, so clamp to the
  // last day of the target month instead.
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  return target.toISOString().slice(0, 10);
}

/**
 * The next due date for a series.
 *
 * `from` is the completed instance's due date, or today when it never had one.
 * "Every board meeting" uses the real calendar rather than a 4-week
 * approximation — the board's own series is last-Thursday but December breaks
 * it deliberately, so an interval would drift off the actual meetings.
 */
export function nextOccurrence(
  recurrence: Recurrence,
  from: string,
  meetingDates: string[],
  today: string
): string | null {
  const base = from > today ? from : today;

  if (recurrence === "each_meeting") {
    return meetingDates.filter((d) => d > base).sort()[0] ?? null;
  }

  const months = recurrence === "monthly" ? 1 : 3;
  let next = addMonths(from, months);
  // If the completed instance was overdue, don't schedule the next one in the
  // past — roll forward until it lands ahead of today.
  let guard = 0;
  while (next <= today && guard < 24) {
    next = addMonths(next, months);
    guard += 1;
  }
  return next;
}
