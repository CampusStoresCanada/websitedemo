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
}

export interface NoticeConfig {
  electronicNoticeEarliestDays: number;
  electronicNoticeLatestDays: number;
  proxyFormDaysBefore: number;
}

/** By-Law Part VII S4(b) and S7(b). */
export const CSC_NOTICE_CONFIG: NoticeConfig = {
  electronicNoticeEarliestDays: 35,
  electronicNoticeLatestDays: 21,
  proxyFormDaysBefore: 30,
};

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

  return {
    opensOn,
    closesOn,
    proxyDueOn,
    combinedFrom: combinedFrom && combinedTo ? combinedFrom : null,
    combinedTo: combinedFrom && combinedTo ? combinedTo : null,
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

  // Inside the window. Flag the tail, because the last days fall over the
  // holidays for a January AGM and there is no board meeting left to catch it.
  const closing = daysLeftInWindow <= 5;
  return {
    code: closing ? "ok_but_closing" : "ok",
    canSend: true,
    daysUntilAgm,
    daysLeftInWindow,
    window,
    message: closing
      ? `${daysLeftInWindow} day${daysLeftInWindow === 1 ? "" : "s"} left — notice must be given by ${window.closesOn}. After that the meeting is improperly called.`
      : `Within the window. Notice must be given by ${window.closesOn}.`,
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
