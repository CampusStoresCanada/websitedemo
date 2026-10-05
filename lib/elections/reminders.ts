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

import type {
  ElectionsConfig,
  NonWorkingDayPolicy,
  ReminderPhase,
  ReminderStep,
} from "./config";
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

export interface PlannedReminderFields {
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

/** An election reminder step with its computed date. Unchanged in shape. */
export type PlannedReminder = ReminderStep & PlannedReminderFields;

export interface ReminderPlan {
  enabled: boolean;
  /** Which deadline these steps count back from. */
  phase: ReminderPhase;
  /** When the phase opens — nominations open, or voting opens. */
  windowOpensAt: string;
  /** The deadline the steps count back from. */
  windowClosesAt: string;
  windowDays: number;
  steps: PlannedReminder[];
  /** Problems that make the whole plan unsafe to run. */
  problems: string[];
  /** Things the admin should see but that do not stop the plan. */
  notes: string[];
}

/**
 * `phase` selects both which steps are planned and which window they sit in.
 * Steps written before phases existed carry none and are treated as ballot
 * steps, which is what they were.
 */
/**
 * A reminder series, generically: count back from a deadline, land on working
 * days, do not collide.
 *
 * ⛔ Extracted so benchmarking does not become a THIRD implementation of this.
 * The renewal series already stores its own `[30, 14, 7, 0]` and this module's
 * opening note says why that is not enough; a third copy would be the same
 * mistake with a different deadline. Everything here was already generic — the
 * only election-specific parts of the original were the WORDS, which the caller
 * now supplies.
 *
 * Pure. No database, no clock, no knowledge of what is being chased.
 */
export interface SeriesStep {
  daysBeforeClose: number;
  label: string;
  audience: string;
  onNonWorkingDay?: NonWorkingDayPolicy;
}

/** How to say, in this cycle's language, what the window and audiences are. */
export interface SeriesWords {
  /** "voting opens", "collection opens" — for a step landing before the window. */
  opensVerb: string;
  /** "voting closes", "the survey closes" — used in each step's description. */
  closeNoun: string;
  /** "voting has closed" — for a step landing after it. */
  closedClause: string;
  /** Audience key to words a person would read. */
  audienceLabel: (audience: string) => string;
}

export function planReminderSeries<S extends SeriesStep>(input: {
  enabled: boolean;
  opensAt: string;
  closesAt: string;
  steps: S[];
  minimumGapDays: number;
  words: SeriesWords;
}): {
  enabled: boolean;
  windowOpensAt: string;
  windowClosesAt: string;
  windowDays: number;
  steps: (S & PlannedReminderFields)[];
  problems: string[];
  notes: string[];
} {
  const { enabled, opensAt, closesAt, steps, minimumGapDays, words } = input;
  const windowDays = daysBetween(opensAt, closesAt);

  const planned = steps
    .map((step) => {
      const policy = step.onNonWorkingDay ?? "move_earlier";
      const ideal = shiftDays(closesAt, -step.daysBeforeClose);
      const { sendOn, movedFrom } = resolveWorkingDay(ideal, policy);
      const movedBecause = movedFrom ? describeNonWorkingDay(movedFrom) : null;
      const deliberate = policy === "send_anyway" && !isWorkingDay(sendOn);

      let problem: string | null = null;
      if (sendOn < opensAt) {
        problem =
          `Lands ${sendOn}, before ${words.opensVerb} on ${opensAt}. ` +
          `The window is only ${windowDays} days, so this step can be at most ${windowDays} days before close.`;
      } else if (sendOn > closesAt) {
        problem = `Lands ${sendOn}, after ${words.closedClause}.`;
      } else if (movedFrom === null && !isWorkingDay(sendOn) && policy !== "send_anyway") {
        problem = `${sendOn} is ${describeNonWorkingDay(sendOn)} and there is no working day within a week to move it to.`;
      }

      const when =
        step.daysBeforeClose === 0
          ? `the day ${words.closeNoun}`
          : `${step.daysBeforeClose} day${step.daysBeforeClose === 1 ? "" : "s"} before ${words.closeNoun}`;

      return {
        ...step,
        onNonWorkingDay: policy,
        sendOn,
        movedFrom,
        movedBecause,
        deliberateNonWorkingDay: deliberate,
        describes: `${when}, to ${words.audienceLabel(step.audience)}`,
        problem,
      } as S & PlannedReminderFields;
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

  return { enabled, windowOpensAt: opensAt, windowClosesAt: closesAt, windowDays, steps: planned, problems, notes };
}

/**
 * `phase` selects both which steps are planned and which window they sit in.
 * Steps written before phases existed carry none and are treated as ballot
 * steps, which is what they were.
 */
export function planReminders(
  schedule: ElectionSchedule,
  config: ElectionsConfig,
  phase: ReminderPhase = "ballot"
): ReminderPlan {
  const { enabled, steps, minimumGapDays } = config.reminders;
  const opensAt =
    phase === "nominations" ? schedule.nominationsOpenAt : schedule.ballotsOpenAt;
  const closesAt =
    phase === "nominations" ? schedule.nominationsCloseAt : schedule.ballotsCloseAt;

  const series = planReminderSeries({
    enabled,
    opensAt,
    closesAt,
    steps: steps.filter((step) => (step.phase ?? "ballot") === phase),
    minimumGapDays,
    words: {
      opensVerb: phase === "nominations" ? "nominations open" : "voting opens",
      closeNoun: phase === "nominations" ? "nominations close" : "voting closes",
      closedClause: phase === "nominations" ? "nominations have closed" : "voting has closed",
      audienceLabel: (a) =>
        a === "not_yet_voted"
          ? "institutions with no ballot on file"
          : a === "has_not_nominated"
            ? "institutions that have put nobody forward"
            : "every eligible institution",
    },
  });

  return { ...series, phase };
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
