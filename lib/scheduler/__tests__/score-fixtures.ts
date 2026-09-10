import type { DelegateProfile, ExhibitorProfile, MatchScoreRecord } from "../types";

/**
 * Score records for scheduler tests, without a scorer.
 *
 * These tests were built on `computeAllMatchScores` — the v2 seven-axis scorer,
 * deleted because nothing in production called it and it still carried
 * `blackout_penalty: -Infinity`, contradicting the live rule that a blackout is
 * a FILTER and never a score. It was only ever scaffolding here: what these
 * files actually test is `generateSchedule`, `isBlackedOut` and
 * `validateScheduleConstraints`.
 *
 * ⛔ EVERY RECORD CLAIMS `isBlackout: false` WITH A HIGH FINITE SCORE — even for
 * a pair one side has refused. That is deliberate, and it makes the blackout
 * tests strictly stronger than they were: the pairing looks perfectly
 * schedulable to the score, so anything that refuses it is refusing on the
 * relationship fact, not on a number. A fixture that flagged the blackout
 * honestly would let generateSchedule pass by trusting the score record, which
 * is the exact coupling `lib/scheduler/blackout.ts` exists to prevent.
 *
 * Scores descend across the cross product so ordering stays deterministic and
 * non-uniform — generateSchedule sorts on `totalScore`, and a flat fixture
 * would make the seeded-tiebreak tests vacuous.
 */
export function fixtureMatchScores(
  delegates: DelegateProfile[],
  exhibitors: ExhibitorProfile[]
): MatchScoreRecord[] {
  const records: MatchScoreRecord[] = [];
  let rank = 0;
  for (const delegate of delegates) {
    for (const exhibitor of exhibitors) {
      records.push({
        delegateSeatId: delegate.registrationId,
        exhibitorSeatId: exhibitor.registrationId,
        exhibitorOrganizationId: exhibitor.organizationId,
        totalScore: 100 - rank++,
        // Open-keyed since v3; the engine's axes change as signals light up.
        breakdown: {},
        reasons: [],
        isBlackout: false,
        isTop5: false,
      });
    }
  }
  return records;
}
