/**
 * Notice of the annual general meeting, and the proxy form.
 *
 * Two obligations under By-Law No. 1 Part VII that are easy to miss because they
 * belong to the MEETING rather than to the election, and both have hard dates:
 *
 *   S4(b)  Notice of the time and place must reach each member entitled to vote
 *          by electronic means during a period of 21 to 35 days before the
 *          meeting. Not "at least 21 days" — a window with a floor AND a
 *          ceiling. Too early is as defective as too late.
 *   S7(b)  Members eligible to vote must be provided with the proxy form 30 days
 *          before the meeting.
 *
 * The consequence of missing S4(b)'s floor is not a telling-off: notice was not
 * given as the by-laws require, so the meeting is improperly called and anything
 * decided at it is open to challenge — including the election of directors. That
 * is why this refuses to send a late notice rather than sending one and noting
 * the problem.
 *
 * Pure. No DB, no clock beyond what the caller passes in.
 */

export interface BlackoutRange {
  from: string;
  to: string;
}

export interface NoticeWindow {
  /** Earliest a notice may be given — 35 days before by default. */
  opensOn: string;
  /** Last day a notice may be given — 21 days before by default. */
  closesOn: string;
  /** By when the proxy form must be in members' hands. */
  proxyDueOn: string;
  /**
   * Days on which BOTH obligations can be discharged in one send. Empty if the
   * two windows do not overlap under a given configuration.
   */
  combinedFrom: string | null;
  combinedTo: string | null;
  /** The correspondence blackout overlapping this window, if any. */
  blackout: BlackoutRange | null;
  /** Days in the window on which a notice would actually be read. */
  usableDays: string[];
  /**
   * The day to aim for — the first usable one. The by-law's closing date is the
   * legal backstop, not the target; treating it as the target is how a notice
   * ends up sent into an empty building.
   */
  recommendedOn: string | null;
}

export interface NoticeConfig {
  electronicNoticeEarliestDays: number;
  electronicNoticeLatestDays: number;
  proxyFormDaysBefore: number;
  /**
   * The stretch of the year when correspondence to campus stores reaches nobody
   * — from the third Friday of December to the first Monday of the new year.
   * Institutions close, and notice sent into it is legally given and practically
   * unread.
   *
   * This does NOT move the by-law window, which is fixed relative to the meeting
   * and cannot be shifted without moving the meeting. It exists so the window's
   * USABLE days can be counted and the opening edge recommended, rather than the
   * closing edge being treated as the target because it is the legal deadline.
   */
  blackout: { fromMonth: number; fromWeekday: number; fromOccurrence: number; toMonth: number; toWeekday: number; toOccurrence: number } | null;
}

/** By-Law Part VII S4(b) and S7(b). */
export const CSC_NOTICE_CONFIG: NoticeConfig = {
  electronicNoticeEarliestDays: 35,
  electronicNoticeLatestDays: 21,
  proxyFormDaysBefore: 30,
  // Third Friday of December through the first Monday of January.
  blackout: {
    fromMonth: 12, fromWeekday: 5, fromOccurrence: 3,
    toMonth: 1, toWeekday: 1, toOccurrence: 1,
  },
};

/** nth weekday of a month, as YYYY-MM-DD. */
function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const matches: Date[] = [];
  const probe = new Date(Date.UTC(year, month - 1, 1));
  while (probe.getUTCMonth() === month - 1) {
    const iso = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
    if (iso === weekday) matches.push(new Date(probe));
    probe.setUTCDate(probe.getUTCDate() + 1);
  }
  return toISODate(matches[occurrence - 1] ?? matches[matches.length - 1]);
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function minusDays(iso: string, days: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() - days * 86_400_000));
}

export function resolveNoticeWindow(
  agmDate: string,
  config: NoticeConfig = CSC_NOTICE_CONFIG
): NoticeWindow {
  const opensOn = minusDays(agmDate, config.electronicNoticeEarliestDays);
  const closesOn = minusDays(agmDate, config.electronicNoticeLatestDays);
  const proxyDueOn = minusDays(agmDate, config.proxyFormDaysBefore);

  // Sending both together is only possible where the notice window still has
  // room on or before the proxy deadline.
  const combinedFrom = proxyDueOn >= opensOn ? opensOn : null;
  const combinedTo = proxyDueOn <= closesOn ? proxyDueOn : null;

  // The blackout is anchored on the year the window falls in, not the meeting's.
  let blackout: BlackoutRange | null = null;
  if (config.blackout) {
    const windowYear = Number(opensOn.slice(0, 4));
    const b = config.blackout;
    const from = nthWeekday(windowYear, b.fromMonth, b.fromWeekday, b.fromOccurrence);
    const toYear = b.toMonth < b.fromMonth ? windowYear + 1 : windowYear;
    blackout = { from, to: nthWeekday(toYear, b.toMonth, b.toWeekday, b.toOccurrence) };
  }

  const usableDays: string[] = [];
  for (let d = parseISODate(opensOn); toISODate(d) <= closesOn; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = toISODate(d);
    if (!blackout || iso < blackout.from || iso > blackout.to) usableDays.push(iso);
  }

  return {
    opensOn,
    closesOn,
    proxyDueOn,
    combinedFrom: combinedFrom && combinedTo ? combinedFrom : null,
    combinedTo: combinedFrom && combinedTo ? combinedTo : null,
    blackout,
    usableDays,
    recommendedOn: usableDays[0] ?? null,
  };
}

export type NoticeVerdictCode =
  | "too_early"
  | "ok"
  | "ok_but_closing"
  | "too_late";

export interface NoticeVerdict {
  code: NoticeVerdictCode;
  /** Whether the send may proceed at all. */
  canSend: boolean;
  daysUntilAgm: number;
  daysLeftInWindow: number;
  window: NoticeWindow;
  message: string;
}

export function evaluateNoticeWindow(
  agmDate: string,
  onDate: string,
  config: NoticeConfig = CSC_NOTICE_CONFIG
): NoticeVerdict {
  const window = resolveNoticeWindow(agmDate, config);
  const daysUntilAgm = Math.round(
    (parseISODate(agmDate).getTime() - parseISODate(onDate).getTime()) / 86_400_000
  );
  const daysLeftInWindow = Math.round(
    (parseISODate(window.closesOn).getTime() - parseISODate(onDate).getTime()) / 86_400_000
  );

  if (onDate < window.opensOn)
    return {
      code: "too_early",
      canSend: false,
      daysUntilAgm,
      daysLeftInWindow,
      window,
      message: `Too early. Notice may not be given more than ${config.electronicNoticeEarliestDays} days before the meeting — the window opens ${window.opensOn}.`,
    };

  if (onDate > window.closesOn)
    return {
      code: "too_late",
      canSend: false,
      daysUntilAgm,
      daysLeftInWindow,
      window,
      message:
        `Too late. Notice had to be given by ${window.closesOn}, at least ` +
        `${config.electronicNoticeLatestDays} days before the meeting. Sending now would not cure it: ` +
        `notice was not given as By-Law Part VII S4 requires, so the meeting is improperly called and ` +
        `anything decided at it — including the election of directors — could be challenged. ` +
        `Take advice before proceeding; moving the meeting may be the cleaner course.`,
    };

  // Inside the window. "Closing" is measured against the last day anyone will
  // READ it, not the last day it may legally be sent — for a January meeting
  // those are two very different dates.
  const lastUsable = window.usableDays[window.usableDays.length - 1] ?? window.closesOn;
  const inBlackout = !!window.blackout && onDate >= window.blackout.from && onDate <= window.blackout.to;
  const closing = onDate >= lastUsable || daysLeftInWindow <= 5;

  return {
    code: closing ? "ok_but_closing" : "ok",
    canSend: true,
    daysUntilAgm,
    daysLeftInWindow,
    window,
    message: inBlackout
      ? `Legally still open until ${window.closesOn}, but campus stores are closed until ${window.blackout!.to} — this notice will be given and not read. Send it, then follow up in the new year.`
      : closing
        ? `Last usable day is ${lastUsable} (institutions close ${window.blackout?.from ?? "—"}). The legal deadline is ${window.closesOn}, but notice given after ${lastUsable} reaches nobody.`
        : `Within the window. Aim for ${window.recommendedOn} — the by-law deadline is ${window.closesOn}, but institutions close ${window.blackout?.from ?? "—"}.`,
  };
}

/** Whether the proxy form deadline has passed. Separate obligation, separate date. */
export function evaluateProxyDeadline(
  agmDate: string,
  onDate: string,
  config: NoticeConfig = CSC_NOTICE_CONFIG
): { canSend: boolean; dueOn: string; overdue: boolean; message: string } {
  const dueOn = minusDays(agmDate, config.proxyFormDaysBefore);
  const overdue = onDate > dueOn;
  return {
    // Late is still worth sending — unlike notice of the meeting, a proxy form
    // arriving late leaves a member worse off but does not invalidate the
    // meeting. Send it and record that it was late.
    canSend: true,
    dueOn,
    overdue,
    message: overdue
      ? `The proxy form was due ${dueOn}, ${config.proxyFormDaysBefore} days before the meeting. Send it anyway — a late form still lets a member appoint a proxy — and record that it went out late.`
      : `Due ${dueOn}.`,
  };
}
