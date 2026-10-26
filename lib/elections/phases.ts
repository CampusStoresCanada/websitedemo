/**
 * Where the cycle is, so the screen can stop showing everything at once.
 *
 * The committee's screen grew a section per feature until it was fourteen
 * full-width panels, nearly all of them about a moment that has either passed
 * or is months away. During nominations it still rendered the ballot reminder
 * schedule and the AGM package in full; after the close it kept the nominee
 * chase, the co-signature chase and a term-history editor per nominee, none of
 * which can do anything once the field is fixed.
 *
 * ⛔ COLLAPSED, NEVER REMOVED. A section that has passed is still the record of
 * what happened, and a committee reconstructing a decision in March needs it.
 * Hiding it behind a summary line is a claim about attention, not about
 * relevance — so every panel stays on the page and stays one click from open.
 *
 * Pure. Takes the election's own state, returns where things sit.
 */

import type { Election } from "./service";

/**
 * The moments the screen organises around. NOT the same as `elections.status`:
 * an acclaimed slate and a balloted one share "the field is fixed" but diverge
 * immediately after, and the screen wants that difference.
 */
export type CyclePhase =
  | "before_nominations"
  | "nominating"
  | "field_fixed"
  | "balloting"
  | "result"
  | "after_meeting";

const ORDER: CyclePhase[] = [
  "before_nominations",
  "nominating",
  "field_fixed",
  "balloting",
  "result",
  "after_meeting",
];

export type SectionState = "past" | "current" | "future";

/**
 * ⚠️ Driven by STATUS first and dates only where status cannot tell them apart.
 * Reading the phase from dates alone would move the screen on at midnight on
 * the closing date whether or not anybody had closed anything — which is
 * exactly the state this cycle sat in for three days.
 */
export function cyclePhase(election: Election, onDate: string): CyclePhase {
  switch (election.status) {
    case "draft":
      return "before_nominations";
    case "nominating":
      return "nominating";
    case "balloting":
      return "balloting";
    case "sealed":
    case "certified":
      // The result exists; after the meeting it is the meeting's business.
      return onDate >= election.schedule.agmDate ? "after_meeting" : "result";
    case "nominations_closed":
      // Acclaimed: no ballot phase to pass through.
      return "field_fixed";
    default:
      return "nominating";
  }
}

/** Where one section sits relative to where the cycle is. */
export function sectionState(section: CyclePhase, current: CyclePhase): SectionState {
  const a = ORDER.indexOf(section);
  const b = ORDER.indexOf(current);
  if (a === b) return "current";
  return a < b ? "past" : "future";
}

/**
 * A balloted cycle passes through balloting; an acclaimed one never does.
 * Without this the ballot panels sit on an acclaimed cycle's screen for ever,
 * permanently "future", waiting for a phase that cannot arrive.
 */
export function phaseApplies(section: CyclePhase, election: Election): boolean {
  if (section !== "balloting") return true;
  return election.outcome !== "acclaimed";
}
