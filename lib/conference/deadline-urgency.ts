/**
 * How hard to press, given how far away the date is.
 *
 * Steve, 2026-08-27: "We want the reminders to start gently and then accelerate
 * as we need them imminently and stop entirely when they're responded to. I
 * don't need to remind you to assign people to your booth tomorrow. I need to
 * know that you've been introduced to that as a thing you will need to do and
 * that I want it done by January 11th."
 *
 * So the first contact is an INTRODUCTION, not a demand. "Do this now" on
 * something 154 days out is noise, and noise is what teaches people to skip the
 * message that matters in January. The date is the point; the urgency is a
 * function of distance from it.
 *
 * Stopping on response is handled elsewhere and deliberately: an answered task
 * never reaches this, because a deadline you have met is not a deadline.
 */

export type UrgencyTone = "introducing" | "planning" | "due_soon" | "imminent" | "passed";

export type Urgency = {
  tone: UrgencyTone;
  /** Days until the date; negative once it has gone. */
  daysUntil: number;
  /** The lead sentence, matched to the distance. */
  lead: string;
};

/** Whole days between two calendar dates, no timezone arithmetic. */
function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Thresholds, and why these.
 *
 * 90+  a season away. Someone needs to KNOW it exists, nothing more.
 * 30+  close enough to plan around, not close enough to chase.
 * 7+   the working fortnight where it should actually get done.
 * <7   now it is urgent, and saying so still means something because we have
 *      not spent the last four months saying it.
 */
export function describeUrgency(deadlineISO: string, todayISO: string): Urgency {
  const daysUntil = daysBetween(todayISO, deadlineISO);

  if (daysUntil < 0) {
    return { tone: "passed", daysUntil, lead: "This date has gone." };
  }
  if (daysUntil === 0) {
    return { tone: "imminent", daysUntil, lead: "Today is the day." };
  }
  if (daysUntil < 7) {
    return {
      tone: "imminent",
      daysUntil,
      lead: daysUntil === 1 ? "Tomorrow." : `${daysUntil} days left.`,
    };
  }
  if (daysUntil < 30) {
    return { tone: "due_soon", daysUntil, lead: "Due shortly." };
  }
  if (daysUntil < 90) {
    return { tone: "planning", daysUntil, lead: "Worth getting to." };
  }
  return {
    tone: "introducing",
    daysUntil,
    // Introduction: you are being told this exists and when it is wanted.
    lead: "Something to know about.",
  };
}

/** Tailwind text colour per tone — quiet far out, loud only when it is true. */
export const URGENCY_CLASS: Record<UrgencyTone, string> = {
  introducing: "text-gray-500",
  planning: "text-gray-600",
  due_soon: "text-amber-700",
  imminent: "text-red-700 font-medium",
  passed: "text-red-700 font-medium",
};

/** A calendar date, `YYYY-MM-DD`, for an instant as seen in a zone. */
export function calendarDayIn(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant
  );
}

export type StaffChecklistGroups<T> = { now: T[]; next: T[]; later: T[]; done: T[] };

/**
 * Where each of the War Room's checklists sits: Now, Next, Later or Done.
 *
 * Stephen, 2026-10-22: things surface as they are needed and move into the
 * background once they are not — and "I don't know how to answer that as a
 * single rule" when asked how far ahead. So there is no lead time to set. The
 * checklists are already in order; order does the work:
 *
 *   now   — open, and its day has come (or gone): today's, and anything late.
 *   next  — the first open checklist after that. Always one, so the next thing
 *           is visible however far away it is.
 *   later — every other open checklist, folded.
 *   done  — every task answered, folded, latest first.
 *
 * "Answered" includes "doesn't apply": a list nobody needs is finished, not
 * outstanding. Days are the conference's, not the server's.
 */
export function arrangeStaffChecklists<T extends { deadline: string; tasks: { state: string }[] }>(
  checklists: T[],
  now: Date,
  timeZone: string
): StaffChecklistGroups<T> {
  const today = calendarDayIn(now, timeZone);
  const ordered = [...checklists].sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  const groups: StaffChecklistGroups<T> = { now: [], next: [], later: [], done: [] };
  for (const list of ordered) {
    if (list.tasks.every((t) => t.state !== "pending")) {
      groups.done.unshift(list);
    } else if (calendarDayIn(new Date(list.deadline), timeZone) <= today) {
      groups.now.push(list);
    } else if (groups.next.length === 0) {
      groups.next.push(list);
    } else {
      groups.later.push(list);
    }
  }
  return groups;
}
