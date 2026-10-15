/**
 * One open ask at a time.
 *
 * Split out of nudge-job.ts for the same reason nudge-schedule.ts was: a test
 * must be able to import this without dragging in the Resend client. The rule
 * it holds only misbehaves ACROSS consecutive nightly runs, so it is precisely
 * the kind of thing that is never noticed until members are complaining.
 *
 * The per-run cap in nudge-job limits one run and does nothing across runs, and
 * the queue is ordered by how long a step has been due. So a member with four
 * dormant steps got four DIFFERENT asks on four consecutive nights, none of
 * them answered, and then all four began their own reminder cycles on top.
 * Spreading a pile-on over a week is not the same as not doing it.
 */

/**
 * How long an asked-but-unanswered step holds the floor when its own schedule
 * sets no reminder. `opening_rfp` and `my_market` are deliberately
 * reminderEveryDays: null — asked once, never chased — and without this they
 * would yield the floor the very next night.
 */
export const LAPSE_AFTER_DAYS_WITHOUT_REMINDERS = 14;

/**
 * Does this asked-but-unanswered step still hold the floor? While one does,
 * no NEW step may start for that person. Reminders for the holder are
 * unaffected — the caller gates only the initial send.
 *
 * Lets go when the step is completed or skipped (those rows never reach here),
 * when its reminders are exhausted, or when a step that never chases has had
 * its fortnight. Then the next task comes.
 */
export function holdsTheFloor(
  row: { sent_at: string | null; last_reminder_sent_at: string | null; reminder_count: number },
  schedule: { reminderEveryDays: number | null; maxReminders: number } | undefined,
  daysSinceFn: (iso: string) => number
): boolean {
  if (!row.sent_at || !schedule) return false;
  const remindersLeft = schedule.maxReminders - row.reminder_count;
  if (schedule.reminderEveryDays !== null && remindersLeft > 0) return true;
  const lastContact = row.last_reminder_sent_at ?? row.sent_at;
  return daysSinceFn(lastContact) < (schedule.reminderEveryDays ?? LAPSE_AFTER_DAYS_WITHOUT_REMINDERS);
}
