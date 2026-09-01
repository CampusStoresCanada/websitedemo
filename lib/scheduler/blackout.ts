/**
 * The blackout rule. There is exactly one, and it lives here.
 *
 * A blackout is a HUMAN relationship fact — "we will not sit in a room with
 * them" — and it is the one input to meeting scheduling that no matching
 * algorithm can ever infer. A partner may have failed to deliver fourteen years
 * ago at a cost nobody wrote down. That history lives in people, and when they
 * express it, it is ground truth.
 *
 * Two consequences, both deliberate:
 *
 * 1. **Conference owns enforcement, not the scorer.** Scores rank; blackouts
 *    exclude. The scheduler must never learn that two orgs may not meet by
 *    reading a number some scoring engine produced — that hands a relationship
 *    fact to a system that cannot know it and cannot be held to it. Score is
 *    advisory ordering ONLY: it may never be the reason a meeting happens, and
 *    never the reason one doesn't.
 *
 * 2. **It is symmetrical.** A partner can fire a customer. Either side
 *    declaring the other blacks out the pair; there is no privileged direction.
 *
 * Before this module the rule existed in three places that disagreed:
 * `scoring.ts` folded it into the score as -Infinity, `generate.ts` trusted
 * that score field, and `constraints.ts` checked the delegate's list directly —
 * one-way. Meanwhile swap handling checked both directions. Generation could
 * therefore create a pairing that the swap system would refuse to move.
 */

/** Either side of a potential meeting: an org, and who it refuses to meet. */
export type BlackoutParty = {
  organizationId: string;
  /** Organization ids this party will not meet. */
  blackoutList: string[];
};

/**
 * True when these two parties may not be scheduled together.
 *
 * Symmetrical by design — see the note above. Compares organization ids, not
 * people: a store declining a vendor means the whole vendor, not one of its
 * staff, and a vendor firing a customer means the whole store.
 */
export function isBlackedOut(left: BlackoutParty, right: BlackoutParty): boolean {
  return (
    left.blackoutList.includes(right.organizationId) ||
    right.blackoutList.includes(left.organizationId)
  );
}
