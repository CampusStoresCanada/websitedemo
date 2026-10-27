/**
 * Who joins the board, who leaves it, and when each happens.
 *
 * Certification establishes the fact; it does not move anybody's access. Those
 * are three different dates and always have been:
 *
 *   - the register says a term ends 2027-01-01
 *   - the members elect AT the annual general meeting, 2027-01-21
 *   - and the outgoing directors stay through the conference after it
 *
 * Collapsing them into one moment is how somebody loses the login they still
 * need, or keeps one they should not. So the plan names both sides separately
 * and each carries its own effective date.
 *
 * ⛔ A PLAN, not an action. Nothing here writes. It reads the certified result
 * against the register and says what would change, so a person can look at the
 * list of names before anybody's access moves.
 *
 * Pure.
 */

export type EffectiveDateChoice = "agm" | "after_conference" | "custom";

export interface TransitionPerson {
  contactId: string;
  profileId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  /**
   * Already holds the access this would grant — an incumbent re-elected, or
   * somebody who is an administrator for another reason entirely. Shown so a
   * list of six names does not imply six changes.
   */
  alreadyHasAccess: boolean;
  /**
   * ⛔ Holds a global role this must never touch. CSC staff and the Executive
   * Director are administrators because of their job, not their seat, and a
   * board transition that demoted them would lock the association out of its
   * own console.
   */
  protectedRole: boolean;
}

export interface BoardTransitionPlan {
  incoming: TransitionPerson[];
  outgoing: TransitionPerson[];
  /** Elected and already serving — listed so the arithmetic is checkable. */
  continuing: TransitionPerson[];
  /** True where nothing would change on either side. */
  noop: boolean;
}

export function resolveEffectiveDate(
  choice: EffectiveDateChoice,
  dates: { agmDate: string; conferenceEndsOn: string | null; custom: string | null }
): { date: string | null; problem: string | null } {
  if (choice === "agm") return { date: dates.agmDate, problem: null };
  if (choice === "after_conference") {
    if (!dates.conferenceEndsOn)
      return {
        date: null,
        problem:
          "No conference with an end date is on record after this meeting, so that option has nothing to resolve to. Pick a custom date.",
      };
    return { date: dates.conferenceEndsOn, problem: null };
  }
  if (!dates.custom || !/^\d{4}-\d{2}-\d{2}$/.test(dates.custom))
    return { date: null, problem: "Enter a date as YYYY-MM-DD." };
  return { date: dates.custom, problem: null };
}

/**
 * ⚠️ Somebody can be on BOTH sides. Three of the four standing in 2027 are
 * incumbents whose terms end at this AGM: they are outgoing from the old term
 * and incoming to the new one. Treating those as two people would remove their
 * access and grant it back, and anybody watching the audit log would see an
 * account briefly stripped for no reason.
 */
export function buildTransitionPlan(input: {
  elected: TransitionPerson[];
  termEndingAtThisAgm: TransitionPerson[];
}): BoardTransitionPlan {
  const electedIds = new Set(input.elected.map((p) => p.contactId));

  const continuing = input.termEndingAtThisAgm.filter((p) => electedIds.has(p.contactId));
  const continuingIds = new Set(continuing.map((p) => p.contactId));

  const incoming = input.elected.filter((p) => !continuingIds.has(p.contactId));
  const outgoing = input.termEndingAtThisAgm.filter((p) => !electedIds.has(p.contactId));

  const grants = incoming.filter((p) => !p.alreadyHasAccess).length;
  const revokes = outgoing.filter((p) => p.alreadyHasAccess && !p.protectedRole).length;

  return { incoming, outgoing, continuing, noop: grants === 0 && revokes === 0 };
}
