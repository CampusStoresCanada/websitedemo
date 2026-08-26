/**
 * When the ballot chase happens, and what each step will actually do.
 *
 * The renewal series stores this as `[30, 14, 7, 0]`. That is a fine thing for
 * a cron to read and a terrible thing to show the person deciding whether the
 * association is being persistent or being a nuisance — it says nothing about
 * what date those land on, who receives them, or whether two of them collide.
 *
 * So this module turns the configured steps into a PLAN: concrete dates, an
 * audience per step, working-day adjustment, and any problems worth refusing to
 * run. The admin screen renders the plan; the cron executes it. Both read the
 * same thing, which is the point — a schedule you cannot preview is a schedule
 * nobody trusts.
 *
 * Working days come from lib/board/vote-schedule.ts rather than a second
 * calendar. That module already decides what a Canadian statutory holiday is
 * for board deadlines, and two holiday tables in one codebase would drift.
 *
 * Pure. No database, no clock of its own.
 */

import type { ElectionsConfig, NonWorkingDayPolicy, ReminderStep } from "./config";
import type { ElectionSchedule } from "./schedule";
import { isBusinessDay, nationalHolidays } from "@/lib/board/vote-schedule";

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (parseISODate(toIso).getTime() - parseISODate(fromIso).getTime()) / 86_400_000
  );
}

function isWorkingDay(iso: string): boolean {
  const d = parseISODate(iso);
  return isBusinessDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Why a date is not a working day, in words a person would use. */
export function describeNonWorkingDay(iso: string): string | null {
  if (isWorkingDay(iso)) return null;
  const d = parseISODate(iso);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return `a ${WEEKDAY[dow]}`;
  return nationalHolidays(d.getUTCFullYear()).has(iso) ? "a statutory holiday" : "a closed day";
}

/**
 * Move a date onto a working day, in the requested direction.
 *
 * Walks at most a week: past that the step has been pushed so far from where it
 * was meant to sit that silently landing it somewhere else would be worse than
 * telling the admin the step cannot be placed.
 */
function resolveWorkingDay(
  iso: string,
  policy: NonWorkingDayPolicy
): { sendOn: string; movedFrom: string | null } {
  if (policy === "send_anyway" || isWorkingDay(iso)) return { sendOn: iso, movedFrom: null };
  const direction = policy === "move_later" ? 1 : -1;
  let cursor = iso;
  for (let i = 0; i < 7; i++) {
    cursor = shiftDays(cursor, direction);
    if (isWorkingDay(cursor)) return { sendOn: cursor, movedFrom: iso };
  }
  return { sendOn: iso, movedFrom: null };
}

export interface PlannedReminder extends ReminderStep {
  /** The date this step will actually send, after working-day adjustment. */
  sendOn: string;
  /** The date it would have landed on, when it was moved. */
  movedFrom: string | null;
  /** Why it moved, e.g. "a Sunday". Null when it did not move. */
  movedBecause: string | null;
  /** One sentence describing what this step does, for the admin screen. */
  describes: string;
  /** A non-working send the admin has explicitly chosen. Worth showing, not fixing. */
  deliberateNonWorkingDay: boolean;
  /** Set when this step cannot run as configured. */
  problem: string | null;
}

export interface ReminderPlan {
  enabled: boolean;
  ballotsOpenAt: string;
  ballotsCloseAt: string;
  windowDays: number;
  steps: PlannedReminder[];
  /** Problems that make the whole plan unsafe to run. */
  problems: string[];
  /** Things the admin should see but that do not stop the plan. */
  notes: string[];
}

export function planReminders(
  schedule: ElectionSchedule,
  config: ElectionsConfig
): ReminderPlan {
  const { enabled, steps, minimumGapDays } = config.reminders;
  const windowDays = daysBetween(schedule.ballotsOpenAt, schedule.ballotsCloseAt);

  const planned: PlannedReminder[] = steps
    .map((step) => {
      const policy = step.onNonWorkingDay ?? "move_earlier";
      const ideal = shiftDays(schedule.ballotsCloseAt, -step.daysBeforeClose);
      const { sendOn, movedFrom } = resolveWorkingDay(ideal, policy);
      const movedBecause = movedFrom ? describeNonWorkingDay(movedFrom) : null;
      const deliberate = policy === "send_anyway" && !isWorkingDay(sendOn);

      let problem: string | null = null;
      if (sendOn < schedule.ballotsOpenAt) {
        problem =
          `Lands ${sendOn}, before voting opens on ${schedule.ballotsOpenAt}. ` +
          `The window is only ${windowDays} days, so this step can be at most ${windowDays} days before close.`;
      } else if (sendOn > schedule.ballotsCloseAt) {
        problem = `Lands ${sendOn}, after voting has closed.`;
      } else if (movedFrom === null && !isWorkingDay(sendOn) && policy !== "send_anyway") {
        problem = `${sendOn} is ${describeNonWorkingDay(sendOn)} and there is no working day within a week to move it to.`;
      }

      const audience =
        step.audience === "not_yet_voted"
          ? "institutions with no ballot on file"
          : "every eligible institution";

      const when =
        step.daysBeforeClose === 0
          ? "the day voting closes"
          : `${step.daysBeforeClose} day${step.daysBeforeClose === 1 ? "" : "s"} before voting closes`;

      return {
        ...step,
        onNonWorkingDay: policy,
        sendOn,
        movedFrom,
        movedBecause,
        deliberateNonWorkingDay: deliberate,
        describes: `${when}, to ${audience}`,
        problem,
      };
    })
    .sort((a, b) => a.sendOn.localeCompare(b.sendOn));

  const problems: string[] = [];
  const notes: string[] = [];

  for (const step of planned) {
    if (step.problem) problems.push(`"${step.label}": ${step.problem}`);

    // Surfaced at SETUP, not discovered at send time. This is the whole reason
    // the panel shows dates instead of day-numbers.
    if (step.movedFrom && step.movedBecause) {
      notes.push(
        `"${step.label}" would have landed on ${step.movedFrom}, ${step.movedBecause}. Moved to ${step.sendOn}.`
      );
    }
    if (step.deliberateNonWorkingDay) {
      notes.push(
        `"${step.label}" sends on ${step.sendOn}, ${describeNonWorkingDay(step.sendOn)} — campus stores are closed. That is what this step is set to do.`
      );
    }
  }

  // Collisions are checked on the ADJUSTED dates. Two steps that were days apart
  // can be shunted onto the same working day by the weekend rule, and only the
  // final dates say whether that happened.
  for (let i = 1; i < planned.length; i++) {
    const gap = daysBetween(planned[i - 1].sendOn, planned[i].sendOn);
    if (gap === 0) {
      problems.push(
        `"${planned[i - 1].label}" and "${planned[i].label}" both land on ${planned[i].sendOn}.`
      );
    } else if (gap < minimumGapDays) {
      problems.push(
        `"${planned[i - 1].label}" and "${planned[i].label}" are ${gap} day${gap === 1 ? "" : "s"} apart, ` +
          `closer than the ${minimumGapDays}-day minimum.`
      );
    }
  }

  return {
    enabled,
    ballotsOpenAt: schedule.ballotsOpenAt,
    ballotsCloseAt: schedule.ballotsCloseAt,
    windowDays,
    steps: planned,
    problems,
    notes,
  };
}

/**
 * The step due today, if any.
 *
 * Exact-date match rather than "on or after", deliberately. A cron that missed
 * a day should not fire yesterday's nudge today — by then the wording ("closing
 * tomorrow") is wrong, and a late reminder that misstates the deadline is worse
 * than a missed one. A skipped step shows on the admin screen as not sent, and
 * a person can decide whether it is still worth sending.
 */
export function reminderDueOn(plan: ReminderPlan, onDate: string): PlannedReminder | null {
  if (!plan.enabled) return null;
  if (plan.problems.length > 0) return null;
  return plan.steps.find((s) => s.sendOn === onDate && !s.problem) ?? null;
}

/** Steps whose date has passed, for showing what already went out. */
export function remindersPast(plan: ReminderPlan, onDate: string): PlannedReminder[] {
  return plan.steps.filter((s) => s.sendOn < onDate);
}
