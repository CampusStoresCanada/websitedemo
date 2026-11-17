/**
 * The terms an election produces.
 *
 * Certification already establishes who was elected — `certifyElection` reads
 * the sealed count or the acclaimed slate and writes `election_certifications`.
 * What it never did was write the one record that answers "who is on the board
 * today": `governance_role_assignments`. The two stores were built at different
 * times and never connected, and `elected_at_election_id` has sat on the table
 * unfilled in all 56 rows since it was added.
 *
 * ⛔ This still does not INFER a term. `lib/actions/director-terms.ts` says a
 * term is a declared fact, and that remains true — the point of this file is
 * that at certification the declaring human is already present and already
 * pressing a button that says the election happened. Recording the terms as
 * part of that act is writing down what they declared, not reconstructing it
 * from a slate. The admin confirms the proposal below before anything is
 * written, and the one genuine judgement — whether a term counts against the
 * four-term cap — stays theirs to set.
 *
 * ⚠️ DATES ARE NOMINAL, and deliberately not the real AGM date.
 *
 * Every one of the 26 director rows already in the register runs January 1 to
 * January 1 — 2025-01-01 → 2027-01-01 — with notes saying "Term dates are
 * AGM-to-AGM; the day is nominal (the cap counts terms, not days)". The real
 * AGMs were 2026-01-15 and 2027-01-21.
 *
 * Writing the true meeting date instead would open a gap. The outgoing term
 * ends 2027-01-01 and a successor starting 2027-01-21 leaves twenty days in
 * which the seat has no holder, every reader of this table reports the board
 * as short, and the governance mailing list empties. Continuity is the thing
 * the register exists to express, so the nominal convention wins and this
 * comment is why.
 *
 * Term length is two years: a director elected at an AGM serves to the second
 * annual meeting following (By-Law Part IV S2). `cycleYear + 2` is the same
 * arithmetic the results announcement already does for `termEndsYear`.
 */

/** A director the election elected, as the certification screen knows them. */
export interface ElectedPerson {
  nominationId: string;
  name: string;
  organizationName: string | null;
  personContactId: string;
  personProfileId: string | null;
  organizationId: string | null;
}

export interface ProposedTerm extends ElectedPerson {
  termStart: string;
  termEnd: string;
  /**
   * True for a full term off a general election, which is every case this
   * function produces. A mid-term appointment to an unexpired vacancy does not
   * count, but that is not an election outcome and is recorded on the board
   * register instead.
   */
  countsTowardCap: boolean;
  /** Already in the register against this election; nothing to write. */
  alreadyRecorded: boolean;
}

/** `2027` → `"2027-01-01"`. */
export function nominalTermBoundary(year: number): string {
  return `${String(year).padStart(4, "0")}-01-01`;
}

export const TERM_LENGTH_YEARS = 2;

/**
 * What certification would write, given who was elected.
 *
 * `alreadyRecorded` carries the idempotency: certifying twice must not give a
 * director two terms, and the caller marks anyone who already has a row
 * stamped with this election. They stay in the list so the screen can show
 * that they are accounted for rather than silently dropping them.
 */
export function proposeElectedTerms(input: {
  cycleYear: number;
  elected: ElectedPerson[];
  alreadyRecordedNominationIds?: readonly string[];
}): ProposedTerm[] {
  const done = new Set(input.alreadyRecordedNominationIds ?? []);
  const termStart = nominalTermBoundary(input.cycleYear);
  const termEnd = nominalTermBoundary(input.cycleYear + TERM_LENGTH_YEARS);

  return input.elected.map((person) => ({
    ...person,
    termStart,
    termEnd,
    countsTowardCap: true,
    alreadyRecorded: done.has(person.nominationId),
  }));
}
