/**
 * Who gets this person's inbox today.
 *
 * ⛔ SYSTEM MAIL IS NOT ON THIS LADDER. A password reset, a receipt, a ticket,
 * an invitation, a notification — anything the person's own action just earned
 * — goes the moment it is earned, is never deferred, never defers anything
 * else, and never counts against any budget. Rate-limiting those is a bug.
 * They are recorded with a null priority so they stay invisible to arbitration.
 *
 * Everything else is MESSAGING: we decided to write to them. One messaging
 * email per person per day, and the most pressing thing wins it.
 *
 * ⚠️ The ladder arbitrates PEOPLE, never sends. A campaign to 400 people still
 * goes out on its date to 399 of them; the one who is also getting a lapse
 * notice that morning has their copy queued to the next working day. A send is
 * never held up for anybody.
 */
export const MESSAGING_PRIORITY = {
  /** A membership lapses on a date. Nothing is allowed to bury this. */
  lapse: 1,
  /** A hard deadline: conference checklist, statutory notice, anything that expires. */
  deadline: 2,
  /** Something happening on a day — events, RFP windows. */
  event: 3,
  /** A campaign. Its date is the IDEAL send date, not a guarantee for each person. */
  campaign: 4,
  /** Onboarding. Last, always: nothing in it expires. */
  onboarding: 5,
} as const;

export type MessagingPriority = (typeof MESSAGING_PRIORITY)[keyof typeof MESSAGING_PRIORITY];

/** Null means system mail: off the ladder entirely. */
export type SendPriority = MessagingPriority | null;

export const PRIORITY_LABEL: Record<number, string> = {
  1: "lapse date",
  2: "deadline",
  3: "event",
  4: "campaign",
  5: "onboarding",
};

/**
 * May a message at `mine` go to someone whose inbox already carries
 * `takenBy` today?
 *
 * Blocked when something at least as pressing has already gone: that is the
 * one-a-day rule. A MORE pressing message still goes — the lower one cannot be
 * un-sent, and burying a lapse notice behind a Toolkit nudge is worse than the
 * person having two emails. In practice the crons run in ladder order so this
 * arm is a backstop, not the normal path.
 */
export function mayTakeInbox(
  mine: MessagingPriority,
  takenBy: number | null
): { allowed: boolean; reason?: string } {
  if (takenBy === null) return { allowed: true };
  if (takenBy <= mine) {
    return {
      allowed: false,
      reason: `inbox already taken today by ${PRIORITY_LABEL[takenBy] ?? takenBy}`,
    };
  }
  return { allowed: true };
}
