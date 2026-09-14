/**
 * Election dates, derived from the AGM.
 *
 * Pure, per the lib/board/vote-schedule.ts convention -- no DB, no clock beyond
 * what callers pass in, so a schedule can be computed for any year and asserted
 * in tests.
 *
 * The four countbacks do NOT overlap, and the gap between them is load-bearing:
 * nominations close 30 days before ballots go out because the committee cannot
 * know whether a ballot is needed until nominations have closed, and then has to
 * build one. Reading the nomination close and the ballot open as the same moment
 * makes the schedule look self-contradictory when it isn't.
 */

import type { ElectionsConfig } from "./config";

export interface ElectionSchedule {
  agmDate: string;
  nominationsOpenAt: string;
  nominationsCloseAt: string;
  ballotsOpenAt: string;
  ballotsCloseAt: string;
}

/** Parse a YYYY-MM-DD as a UTC date. Never `new Date(str)` -- that reads as local. */
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function minusDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000);
}

/**
 * The nth occurrence of a weekday in a month, e.g. the third Wednesday of
 * January. `weekday` is ISO (Mon=1 .. Sun=7); `occurrence` is 1-based.
 * Returns null if the month has no such occurrence (e.g. a fifth Wednesday).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number
): string | null {
  const matches: Date[] = [];
  const probe = new Date(Date.UTC(year, month - 1, 1));
  while (probe.getUTCMonth() === month - 1) {
    const iso = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
    if (iso === weekday) matches.push(new Date(probe));
    probe.setUTCDate(probe.getUTCDate() + 1);
  }
  const hit = matches[occurrence - 1];
  return hit ? toISODate(hit) : null;
}

/** The AGM date for a cycle year, where the association pins it by rule. */
export function resolveAgmDate(config: ElectionsConfig, year: number): string | null {
  if (!config.agmRule) return null;
  const { month, weekday, occurrence } = config.agmRule;
  return nthWeekdayOfMonth(year, month, weekday, occurrence);
}

/** Derive the four windows from the AGM date. */
export function deriveSchedule(agmDate: string, config: ElectionsConfig): ElectionSchedule {
  const agm = parseISODate(agmDate);
  const s = config.schedule;
  return {
    agmDate,
    nominationsOpenAt: toISODate(minusDays(agm, s.nominationsOpenDaysBefore)),
    nominationsCloseAt: toISODate(minusDays(agm, s.nominationsCloseDaysBefore)),
    ballotsOpenAt: toISODate(minusDays(agm, s.ballotsOpenDaysBefore)),
    ballotsCloseAt: toISODate(minusDays(agm, s.ballotsCloseDaysBefore)),
  };
}

/**
 * Is this schedule internally coherent? A misconfigured countback (ballots
 * opening before nominations close, say) would silently produce an election
 * nobody could participate in, so callers check before opening one.
 */
export function validateSchedule(schedule: ElectionSchedule): string[] {
  const problems: string[] = [];
  const { nominationsOpenAt, nominationsCloseAt, ballotsOpenAt, ballotsCloseAt, agmDate } = schedule;

  if (nominationsOpenAt >= nominationsCloseAt)
    problems.push("Nominations must open before they close.");
  if (nominationsCloseAt > ballotsOpenAt)
    problems.push(
      "Ballots cannot go out before nominations close — the committee cannot know whether a ballot is needed until then."
    );
  if (ballotsOpenAt >= ballotsCloseAt) problems.push("Ballots must open before they close.");
  if (ballotsCloseAt > agmDate) problems.push("Ballots must be returned before the AGM.");

  return problems;
}

export type ElectionPhase =
  | "before_nominations"
  | "nominating"
  | "between_nominations_and_ballot"
  | "balloting"
  | "after_ballot"
  | "after_agm";

/** Which phase a given date falls in. Dates are compared as YYYY-MM-DD strings. */
export function phaseOn(schedule: ElectionSchedule, onDate: string): ElectionPhase {
  if (onDate < schedule.nominationsOpenAt) return "before_nominations";
  if (onDate < schedule.nominationsCloseAt) return "nominating";
  if (onDate < schedule.ballotsOpenAt) return "between_nominations_and_ballot";
  if (onDate < schedule.ballotsCloseAt) return "balloting";
  if (onDate < schedule.agmDate) return "after_ballot";
  return "after_agm";
}

export type NominationCloseReadiness =
  | { ready: true; onTime: boolean; daysLate: number }
  | { ready: false; daysEarly: number; reason: string };

/**
 * May nominations be closed today?
 *
 * Closing is not a discretionary act. The nomination window is published to the
 * membership in the call for nominations, and a member who has not yet acted is
 * entitled to the whole of it. Closing on the 20th a window that runs to the
 * 23rd removes a right three days early — the same defect, in the other
 * direction, as issuing notice of a meeting outside its window.
 *
 * So: refused before `nominationsCloseAt`, permitted on or after it. There is
 * deliberately no override. If the date itself is wrong, the schedule is the
 * thing to change, and every derived date moves with it.
 *
 * Closing LATE is permitted and merely noted. An election that nobody got round
 * to closing on the day is untidy; one closed early is defective.
 */
export function canCloseNominations(
  schedule: ElectionSchedule,
  onDate: string
): NominationCloseReadiness {
  const close = parseISODate(schedule.nominationsCloseAt);
  const today = parseISODate(onDate);
  const days = Math.round((today.getTime() - close.getTime()) / 86_400_000);

  if (days < 0) {
    const early = Math.abs(days);
    return {
      ready: false,
      daysEarly: early,
      reason:
        `Nominations run to ${schedule.nominationsCloseAt} — ${early} day${early === 1 ? "" : "s"} from now. ` +
        `Closing early would take the right to nominate away from members who have not acted yet. ` +
        `If that date is wrong, change the schedule rather than closing ahead of it.`,
    };
  }

  return { ready: true, onTime: days === 0, daysLate: days };
}

/**
 * By-Law Part V S3(a): ballots are circulated no less than 60 days before the
 * AGM. A FLOOR on how much time members get, which makes it a CEILING on the
 * date — the last day circulation may happen, never the first.
 */
export const BALLOT_CIRCULATION_DEADLINE_DAYS_BEFORE_AGM = 60;

export type BallotOpenReadiness =
  | { open: true; early: boolean; daysEarly: number; pastByLawDeadline: boolean }
  | { open: false; reason: string };

/**
 * May the ballot be open today?
 *
 * `ballotsOpenAt` used to gate this, and read as a date voting was forbidden
 * before. That was wrong in a way nobody noticed because the derived dates hid
 * it: the by-law sets a LAST day to circulate (60 days out), not a first, and
 * the 26 days between nominations closing and the derived open date were an
 * allowance for the committee to build the ballot — a work estimate, not a
 * right anybody holds. Nominations closing already fixes the field, so from
 * that moment there is nothing left to wait for, and waiting only costs
 * turnout.
 *
 * So the open date is now a PLAN rather than a gate. What actually gates voting:
 *
 *   - the field must be fixed — carried by `status === "balloting"`, which only
 *     closeNominations sets, and only after validating every nomination;
 *   - voting must not have closed. `ballotsCloseAt` IS a hard date, because
 *     members were told when to vote by and a ballot arriving after it is a
 *     vote taken away. Opening early never shortens that window; it only ever
 *     lengthens it, which is why this direction is safe and the other is not.
 *
 * Circulating LATER than the by-law deadline is reported, not refused. A late
 * ballot is a defect; refusing to send it turns that into no election at all.
 */
export function canOpenBallots(
  schedule: ElectionSchedule,
  onDate: string
): BallotOpenReadiness {
  if (onDate >= schedule.ballotsCloseAt) {
    return {
      open: false,
      reason:
        `Voting closed on ${schedule.ballotsCloseAt}. A ballot circulated now could not be returned in time, ` +
        `so it would take the vote away rather than offer it.`,
    };
  }

  const planned = parseISODate(schedule.ballotsOpenAt);
  const today = parseISODate(onDate);
  const days = Math.round((planned.getTime() - today.getTime()) / 86_400_000);
  const deadline = toISODate(
    minusDays(parseISODate(schedule.agmDate), BALLOT_CIRCULATION_DEADLINE_DAYS_BEFORE_AGM)
  );

  return {
    open: true,
    early: days > 0,
    daysEarly: Math.max(0, days),
    pastByLawDeadline: onDate > deadline,
  };
}
