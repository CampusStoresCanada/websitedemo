/**
 * When a checklist reminds people — derived, never hand-authored.
 *
 * Checkpoints used to be rows somebody typed in per checklist. Two silent
 * failures followed, measured on CSC 2027 (2026-09-24):
 *
 *   Meeting preferences  0 checkpoints  active, has tasks, sent nothing ever
 *   Your Conference      0 checkpoints  active, has tasks, sent nothing ever
 *
 * Nothing threw. The checklists rendered correctly on the org page, the admin
 * screen showed them as active, and the reminder job passed over them every
 * night because a checklist with no checkpoints has nothing due. Forgetting to
 * type three rows was indistinguishable from a working checklist.
 *
 * And the anchor was wrong even when the rows existed. `days_before_deadline`
 * counts back from the CHECKLIST's deadline, so a task that hardens earlier
 * than the checklist is first mentioned after it is already too late —
 * Conference in a Box must arrive 20 November against an Exhibitor checklist
 * whose first reminder goes out 27 November.
 *
 * So the cadence is computed from the dates the tasks already carry, anchored
 * to whichever hardens FIRST. Nobody configures a reminder; adding a task with
 * an earlier deadline widens the schedule on the next run by itself.
 */

import { isBusinessDay } from "@/lib/board/vote-schedule";

/**
 * Days before the anchor that a reminder goes out.
 *
 * Three, spread wide: far enough out to act on, once more while there is still
 * room, and a last call. This is the shape the hand-authored rows used and the
 * one the copy is written for — it is now applied everywhere rather than
 * wherever somebody remembered to type it.
 */
export const STANDARD_CADENCE_DAYS = [45, 21, 7] as const;

/**
 * Off-switch, the same shape elections uses.
 *
 * `ELECTIONS_SUPPRESS_EMAIL=1` exists because "did not email 40 campus stores"
 * is not a property to leave to configuration. Checklist reminders reach a
 * wider list than elections do, and deriving the cadence means a checklist
 * silent for months can start sending on the next tick.
 */
export function checklistEmailSuppressed(): boolean {
  return process.env.CHECKLIST_SUPPRESS_EMAIL === "1";
}

/**
 * Reminders land on a working day, the way board votes already do.
 *
 * Adopted from lib/board/vote-schedule.ts rather than reimplemented — it
 * already knows the national holidays and observes the ones that fall on a
 * weekend. A derived offset is a DATE once it meets the deadline, and a
 * conference cadence runs straight through late December: the Exhibitor
 * checklist's middle reminder falls on 21 December and its last on 4 January.
 *
 * Shifted EARLIER, never later. A reminder is about something that hardens on
 * a date, so arriving before a weekend is useful and arriving after it is not.
 */
function shiftToBusinessDay(date: Date): Date {
  const out = new Date(date);
  for (let i = 0; i < 7; i++) {
    if (isBusinessDay(out.getUTCFullYear(), out.getUTCMonth() + 1, out.getUTCDate())) return out;
    out.setUTCDate(out.getUTCDate() - 1);
  }
  return out;
}

/** Whole days between two calendar dates, positive when `later` is later. */
function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * The `days_before_deadline` offsets a checklist should have.
 *
 * Offsets stay expressed against the CHECKLIST's deadline because that is what
 * the reminder query compares against and what the log's uniqueness is built
 * on. Anchoring earlier simply makes them larger: a checklist closing 11
 * January whose first task hardens 20 November gets offsets of 97/73/59 rather
 * than 45/21/7, so the first reminder still lands 45 days before the thing it
 * is about.
 *
 * `earliestTaskDeadline` may be null — a checklist whose tasks carry no dates
 * of their own falls back to the checklist's own deadline, which is exactly
 * what the hand-authored rows meant.
 */
export function deriveCheckpointOffsets(
  checklistDeadline: Date,
  earliestTaskDeadline: Date | null
): number[] {
  const anchorShift =
    earliestTaskDeadline && earliestTaskDeadline < checklistDeadline
      ? daysBetween(earliestTaskDeadline, checklistDeadline)
      : 0;

  return STANDARD_CADENCE_DAYS.map((d) => {
    // Turn the offset into the day it actually lands on, move it off a weekend
    // or holiday, then turn it back — so the stored offset already encodes a
    // working day and the due query needs to know nothing about calendars.
    const raw = new Date(checklistDeadline);
    raw.setUTCDate(raw.getUTCDate() - (d + anchorShift));
    return daysBetween(shiftToBusinessDay(raw), checklistDeadline);
  })
    // A checklist already inside its own window still gets its full cadence;
    // findDueOrgs treats every past offset as due and sends the most overdue
    // unlogged one, so nobody receives a backlog burst from a wide offset.
    .sort((a, b) => b - a);
}
