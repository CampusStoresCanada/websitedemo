/**
 * Which renewal cycle is a member declining when they opt out?
 *
 * Pure rule, no DB — so it can be tested directly and read on its own.
 *
 * An opt-out is always a statement about the next thing we would bill for. It
 * is never a statement about coverage already paid for. Langara College
 * (2026-09) is the case that forced this apart: they paid on Sept 10 for the
 * term running to 2027-08-31, clicked "Opt out of renewal" on Sept 17, and the
 * old code read that as a cancellation of the term they had just bought,
 * terminating an in-force membership and writing a refund against it. The
 * sentence they typed was about reminder timing.
 */
export interface OptOutScope {
  /**
   * Is paid coverage still in force? When true, the current term, its status
   * and its money are all left alone.
   */
  coverageInForce: boolean;
  /** The renewal year the opt-out is recorded against. */
  renewalYear: number;
}

/**
 * @param membershipExpiresAt `organizations.membership_expires_at`, date-only
 *   or full timestamp, or null for a member who has never completed a cycle.
 * @param today Today as YYYY-MM-DD.
 */
export function resolveOptOutScope(
  membershipExpiresAt: string | null,
  today: string
): OptOutScope {
  const expiresAt = membershipExpiresAt?.split("T")[0] ?? null;
  // Both sides are YYYY-MM-DD, so a lexicographic compare is a date compare.
  // Same convention as membershipCoversConference in lib/conference.
  const coverageInForce = !!expiresAt && expiresAt >= today;

  if (coverageInForce) {
    // Coverage ending 2027-08-31 means the next cycle starts 2027-09-01, which
    // is renewal year 2028 under the cycle-start-year-plus-one convention
    // documented in lib/renewal/season.ts.
    return { coverageInForce, renewalYear: Number(expiresAt!.slice(0, 4)) + 1 };
  }

  // No coverage left, so they are declining the cycle we are billing now.
  // Months are zero-based: >= 8 is September onward, when the cycle that just
  // started is already labelled next year.
  const todayDate = new Date(`${today}T00:00:00Z`);
  const renewalYear =
    todayDate.getUTCMonth() >= 8
      ? todayDate.getUTCFullYear() + 1
      : todayDate.getUTCFullYear();

  return { coverageInForce, renewalYear };
}
