import { optimizeSchedule, type OptimizeContext } from "./optimize";
import type { ScheduleAssignment } from "./types";

/**
 * Seat a late registrant into a FROZEN schedule without moving anybody else.
 *
 * ⛔ THE SCHEDULE FREEZES 18 JANUARY; THE CONFERENCE IS 2 FEBRUARY. Between
 * those dates people have already been told where to be. Re-running the search
 * would return a higher objective and a worse outcome — every delegate whose
 * day shifted would have been moved for a stranger's convenience, after being
 * told it was final. So this is deliberately NOT "optimize again with one more
 * person in the pool".
 *
 * It runs FILL alone: a new meeting in an empty suite-slot, displacing nobody.
 * split, swap and rescue all rearrange people who are already placed.
 *
 * ⚠️ IT VERIFIES RATHER THAN TRUSTS. FILL is additive by construction today,
 * but "by construction" is a property of code that changes. If any pre-existing
 * meeting differs afterwards — a delegate added, removed, or the whole meeting
 * gone — this THROWS instead of returning a schedule that quietly moved
 * somebody. A late add that silently reshuffles the show is far worse than one
 * that fails loudly in January with three weeks to sort it out.
 */

export type LateAddResult = {
  /** The frozen schedule plus whatever new meetings FILL could add. */
  assignments: ScheduleAssignment[];
  /** Only the meetings that did not exist before. */
  added: ScheduleAssignment[];
  /** Delegate seats that had NO meetings before and now hold at least one. */
  newlySeated: string[];
  /**
   * Delegates who already had meetings and picked up another.
   *
   * ⛔ READ THIS BEFORE SENDING ANYTHING OUT. "Displaces nobody" is not the same
   * as "changes nobody's day". Group minimum is 2, so a lone latecomer cannot be
   * seated by themselves — FILL has to pair them with someone else who is free
   * at that minute and has not met that exhibitor. That someone is usually an
   * existing delegate, whose printed schedule then gains a meeting it did not
   * have when it was sent on 18 January.
   *
   * Nobody is moved and nothing is taken away, so this is far milder than a
   * reshuffle — but it is still a change to a document somebody is holding, and
   * whoever runs a late add owes these people a note. The list exists so that
   * obligation is visible instead of buried in a diff.
   */
  alsoGained: string[];
  /**
   * Delegates still holding no meeting at all.
   *
   * ⚠️ Not necessarily the latecomer, and not necessarily a failure. FILL can
   * only use spare room; once every slot an exhibitor holds is occupied there
   * is no legal additive move left. Reporting this honestly is the point —
   * somebody arriving three days before the show may genuinely have nowhere to
   * sit, and that is a phone call, not a bug.
   */
  stillWithoutMeetings: string[];
};

/** (slot, exhibitor) identifies a meeting; its delegates are its content. */
const meetingKey = (a: ScheduleAssignment) => `${a.meetingSlotId}::${a.exhibitorSeatId}`;

export function lateAddFill(
  frozen: ScheduleAssignment[],
  context: OptimizeContext
): LateAddResult {
  const result = optimizeSchedule(frozen, {
    ...context,
    moves: { fill: true, split: false, swap: false, rescue: false },
  });

  assertFrozenSurvived(frozen, result.assignments);

  const before = new Set(frozen.map(meetingKey));
  const added = result.assignments.filter((a) => !before.has(meetingKey(a)));

  const countBy = (assignments: ScheduleAssignment[]) => {
    const n = new Map<string, number>();
    for (const a of assignments) {
      for (const d of a.delegateSeatIds) n.set(d, (n.get(d) ?? 0) + 1);
    }
    return n;
  };
  const was = countBy(frozen);
  const now = countBy(result.assignments);

  const newlySeated: string[] = [];
  const alsoGained: string[] = [];
  for (const [delegateSeatId, after] of now) {
    const before = was.get(delegateSeatId) ?? 0;
    if (after <= before) continue;
    (before === 0 ? newlySeated : alsoGained).push(delegateSeatId);
  }

  const stillWithoutMeetings = [...context.delegateSeats.keys()]
    .filter((d) => (now.get(d) ?? 0) === 0)
    .sort();

  return {
    assignments: result.assignments,
    added,
    newlySeated: newlySeated.sort(),
    alsoGained: alsoGained.sort(),
    stillWithoutMeetings,
  };
}

/**
 * Every meeting that existed before must exist after, with exactly the same
 * people in it. Throws with the specific meeting rather than a generic failure,
 * because whoever reads this in January needs to know which room moved.
 */
function assertFrozenSurvived(
  frozen: ScheduleAssignment[],
  after: ScheduleAssignment[]
): void {
  const afterByKey = new Map(after.map((a) => [meetingKey(a), a] as const));

  for (const original of frozen) {
    const key = meetingKey(original);
    const now = afterByKey.get(key);
    if (!now) {
      throw new Error(`late-add removed a frozen meeting: ${key}`);
    }
    const wasThere = [...original.delegateSeatIds].sort();
    const isThere = [...now.delegateSeatIds].sort();
    if (wasThere.join(",") !== isThere.join(",")) {
      throw new Error(
        `late-add changed who is in a frozen meeting: ${key} — ` +
          `was [${wasThere.join(", ")}], now [${isThere.join(", ")}]`
      );
    }
  }
}
