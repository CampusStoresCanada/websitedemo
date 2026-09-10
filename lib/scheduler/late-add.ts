import { optimizeSchedule, type OptimizeContext, type OptimizeResult } from "./optimize";
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
 * It runs the two additive moves, JOIN first:
 *
 *   join  adds one person to an under-full existing meeting — a two becomes a
 *         three. Same slot, same exhibitor, same people, plus one.
 *   fill  opens a new meeting in an empty suite-slot when two or more people
 *         need seating together.
 *
 * split, swap and rescue all rearrange people who are already placed, so all
 * three are off.
 *
 * ⛔ JOIN FIRST IS THE WHOLE DESIGN, per Steve: "they still don't meet solo.
 * They become a three or wait for another solo add." A lone arrival cannot be
 * seated by FILL — group minimum is 2, so FILL would have to drag in a second
 * delegate who was never promised that meeting. JOIN has no such floor, because
 * the meeting it joins already satisfies the minimum. So one latecomer joins an
 * existing room; two latecomers can open a new one together; one latecomer with
 * no under-full room waits for the next one rather than costing anyone else a
 * change. Their schedule is not shipped the moment they register, which is what
 * makes waiting a real option.
 *
 * ⚠️ IT VERIFIES RATHER THAN TRUSTS. Both moves are additive by construction
 * today, but "by construction" is a property of code that changes. If anybody
 * is dropped from a meeting they already had, or a meeting disappears, this
 * THROWS rather than returning a schedule that quietly moved somebody. A late
 * add that silently reshuffles the show is far worse than one that fails loudly
 * in January with three weeks to sort it out.
 */

export type LateAddResult = {
  /** The frozen schedule plus whatever new meetings FILL could add. */
  assignments: ScheduleAssignment[];
  /** Objective before and after, so a persisted run reports its real score. */
  objective: { before: OptimizeResult["before"]; after: OptimizeResult["after"] };
  /** Only the meetings that did not exist before. */
  added: ScheduleAssignment[];
  /** Delegate seats that had NO meetings before and now hold at least one. */
  newlySeated: string[];
  /**
   * Delegates who already had meetings and picked up another.
   *
   * ⚠️ USUALLY EMPTY, and it should stay that way. JOIN runs first and adds the
   * latecomer to an existing room, which gives nobody else anything. This list
   * fills only when FILL had to open a NEW meeting, because a new meeting needs
   * meetingGroupMin bodies — so somebody already registered gets pulled in and
   * their day gains a meeting it did not have on 18 January.
   *
   * Nobody is moved and nothing is taken away, so it is far milder than a
   * reshuffle. But it is still a change to a document somebody is holding, so
   * these people need their schedule RE-SENT — the `conference_schedule_ready`
   * template exists for exactly that. Not a phone call: a re-send. A long list
   * is the signal to wait for the next arrival rather than seat this one.
   */
  alsoGained: string[];
  /**
   * Delegates still holding no meeting at all.
   *
   * ⚠️ Not necessarily the latecomer, and not necessarily a failure. FILL can
   * only use spare room; once every slot an exhibitor holds is occupied there
   * is no legal additive move left. Reporting this honestly is the point —
   * somebody arriving three days before the show may genuinely have nowhere to
   * sit. That is a conversation with them, not a defect to fix here.
   */
  stillWithoutMeetings: string[];
};

/** (slot, exhibitor) identifies a meeting; its delegates are its content. */
const meetingKey = (a: ScheduleAssignment) => `${a.meetingSlotId}::${a.exhibitorSeatId}`;

export function lateAdd(
  frozen: ScheduleAssignment[],
  context: OptimizeContext
): LateAddResult {
  const result = optimizeSchedule(frozen, {
    ...context,
    moves: { join: true, fill: true, split: false, swap: false, rescue: false },
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
    objective: { before: result.before, after: result.after },
    added,
    newlySeated: newlySeated.sort(),
    alsoGained: alsoGained.sort(),
    stillWithoutMeetings,
  };
}

/**
 * Every meeting that existed before must still exist, and everyone who was in it
 * must still be in it. Gaining a delegate is allowed — that is JOIN, and it is
 * the point. LOSING one is not, and neither is a meeting vanishing.
 *
 * ⛔ THE INVARIANT IS "NOBODY LOSES ANYTHING", NOT "NOTHING CHANGED". Those are
 * different, and the weaker-sounding one is the one that matches the promise:
 * a delegate told on 18 January that they meet Boxercraft at 9:30 still meets
 * Boxercraft at 9:30. Somebody else joining that room does not break that.
 *
 * Throws naming the specific meeting, because whoever reads this in January
 * needs to know which room moved rather than that some room did.
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
    const stillSeated = new Set(now.delegateSeatIds);
    const dropped = original.delegateSeatIds.filter((d) => !stillSeated.has(d));
    if (dropped.length > 0) {
      throw new Error(
        `late-add removed somebody from a frozen meeting: ${key} — ` +
          `lost [${dropped.join(", ")}]`
      );
    }
  }
}
