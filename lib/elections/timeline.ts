/**
 * The stage VOCABULARY — what one step of an ordered progress list looks like.
 *
 * ⚠️ Shared, and not really the elections module's to own: `TimelineStage` is
 * imported by benchmarking (`lib/benchmarking/timeline.ts`,
 * `app/benchmarking/admin/[year]/page.tsx`), by the admin calendar and by
 * `ElectionTimeline`, which renders any spine given to it. It still lives here
 * because moving it would touch benchmarking's imports, and the FY2026 cycle is
 * collecting until 2026-11-20. Finish that move after.
 *
 * ⛔ The BUILDER left. A meeting of the members is built into a spine by
 * `buildMeetingSpine` in `lib/governance/meeting-spine.ts` — the meeting is the
 * activity and the election is business at it, so the builder belongs to
 * governance. This file is types and one selector.
 *
 * The argument for a single ordered list, which `lib/benchmarking/lifecycle.ts`
 * cites: a screen that grows a panel at a time ends up ordered by what was
 * built rather than by what happens. That is fine while you already know the
 * process and useless while you are learning it — and these run once a year, so
 * nobody ever stops learning them.
 */

export type StageState =
  /** Finished, with the date it happened. */
  | "done"
  /** Actionable now. */
  | "current"
  /** Its date has passed and it did not happen. */
  | "overdue"
  /** Still ahead. */
  | "upcoming"
  /** Cannot happen until something else does. */
  | "blocked"
  /** Does not apply to this cycle. */
  | "not_applicable";

export interface TimelineStage {
  key: string;
  label: string;
  /** The date it happens or is due. A window uses `on` + `until`. */
  on: string | null;
  /**
   * The far end of a window, when this stage is one.
   *
   * ⛔ Real dates, not only the prose in `windowLabel`. A window has to be
   * missable from BOTH ends — the AGM notice is defective sent too early as
   * well as too late — and anything consuming a stage programmatically (the
   * admin calendar renders projected items with a start and an end) cannot get
   * that out of a label. `windowLabel` stays for display, so a screen keeps
   * saying "2026-12-17 to 2026-12-31" rather than re-formatting these.
   */
  until: string | null;
  windowLabel: string | null;
  state: StageState;
  /** What happened, or what it is waiting for. */
  detail: string;
  /** The action that moves this stage, when one is available now. */
  action: {
    key: string;
    label: string;
    /** Set when the action exists but cannot run yet. */
    blockedBy: string | null;
  } | null;
}

/**
 * The one stage a person should look at first.
 *
 * Falls through to the next upcoming stage rather than returning nothing. In
 * the quiet months every stage is "upcoming", and a screen that answers "what
 * now?" with silence is worse than one that says "nothing yet — the call for
 * nominations goes out on 23 September."
 */
export function currentStage(stages: TimelineStage[]): TimelineStage | null {
  return (
    stages.find((st) => st.state === "overdue") ??
    stages.find((st) => st.state === "current" && st.action && !st.action.blockedBy) ??
    stages.find((st) => st.state === "current") ??
    stages.find((st) => st.state === "upcoming") ??
    null
  );
}
