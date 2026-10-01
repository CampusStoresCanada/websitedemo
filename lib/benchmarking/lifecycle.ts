import { CAPABILITIES } from "@/lib/auth/capability-names";

/**
 * The survey's ladder: one ordered list of states, each with the job that is
 * live while it holds and the transition that moves it on.
 *
 * Modelled on the elections cycle, deliberately and closely. There, the state
 * is the clock and each capability is the roster for one phase — see
 * lib/elections/timeline.ts, whose opening comment is the argument for a single
 * chronological spine over controls scattered in the order they were built.
 * This runs once a year too, so nobody ever stops learning it.
 *
 * ⛔ NOT server-only, on purpose. The admin card that renders the ladder is a
 * client component and survey-access.ts is server-only, so neither could host
 * this and both need it. That is the whole reason this module exists; it holds
 * vocabulary and no behaviour.
 *
 * ── The pair ─────────────────────────────────────────────────────
 * A state and a permission are two different things and both are needed:
 * `beta` is the state the SURVEY is in, `benchmarking.beta_tester` is the job a
 * PERSON holds. The state turns a phase on; the permission says who does it.
 * Appointing happens on the committee card, the same panel as every other
 * benchmarking capability. Treating the two as interchangeable is how the beta
 * ended up with three appointment paths and two invitation emails.
 */

export type SurveyState =
  | "draft"
  | "beta"
  | "open"
  | "closed"
  | "processing"
  | "complete";

export interface SurveyStateDef {
  state: SurveyState;
  label: string;
  /** What is true while the survey sits here. */
  meaning: string;
  /** Who may file, in plain words, for the admin screen. */
  whoFiles: string;
  /**
   * The capability whose work is live in this state, if any.
   *
   * This is the state/permission pair made explicit: the ladder says WHEN,
   * the capability says WHO. Null means no appointed job runs here.
   */
  liveCapability: string | null;
  /** The move out of this state, and what to call the button that makes it. */
  next: { state: SurveyState; label: string } | null;
}

/*
  ⛔ Every state here is already legal in the database.
  benchmarking_surveys_status_check allows exactly
  draft | beta | open | closed | processing | complete, so this ladder needs no
  migration — `beta` was always permitted and simply had no way to be reached,
  which is what made the beta phase look unbuilt.

  Stages still to come — question review, synthesis, beta delivery, delivery —
  are NOT listed, because a state the CHECK rejects would render a button that
  cannot succeed, and a button that cannot succeed reads as broken software
  rather than as a step not built yet. They arrive as rows here plus one
  constraint migration. See the 2027 plan.
*/
export const SURVEY_LADDER: SurveyStateDef[] = [
  {
    state: "draft",
    label: "Draft",
    meaning: "Being written. Question review happens against whatever the newest survey says.",
    whoFiles: "Nobody. Admins can open it to look.",
    liveCapability: CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
    next: { state: "beta", label: "Start beta testing" },
  },
  {
    state: "beta",
    label: "Beta testing",
    meaning:
      "A handful of stores go first, for real, so a question that reads two ways is found before the whole membership meets it.",
    whoFiles: "Appointed beta testers, for their own store.",
    liveCapability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    next: { state: "open", label: "Open to everyone" },
  },
  {
    state: "open",
    label: "Open",
    meaning:
      "Every member store is invited and can file. Flagged figures and flagged questions both become interpretation work.",
    whoFiles: "Every active member store.",
    liveCapability: CAPABILITIES.BENCHMARKING_QA_VERIFY,
    next: { state: "closed", label: "Close the survey" },
  },
  {
    state: "closed",
    label: "Closed",
    meaning: "Collection is over. Nothing more can be filed; interpretation finishes.",
    whoFiles: "Nobody.",
    liveCapability: CAPABILITIES.BENCHMARKING_QA_VERIFY,
    next: { state: "processing", label: "Begin processing" },
  },
  {
    state: "processing",
    label: "Processing",
    meaning: "The figures are being turned into the report the membership reads.",
    whoFiles: "Nobody.",
    liveCapability: CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD,
    next: { state: "complete", label: "Mark complete" },
  },
  {
    state: "complete",
    label: "Complete",
    meaning: "Published. The cycle's figures are released and comparable.",
    whoFiles: "Nobody.",
    liveCapability: null,
    next: null,
  },
];

const BY_STATE = new Map<string, SurveyStateDef>(
  SURVEY_LADDER.map((d) => [d.state, d]),
);

/** The ladder entry for a status, or null for one we do not recognise. */
export function surveyState(status: string | null | undefined): SurveyStateDef | null {
  return status ? BY_STATE.get(status) ?? null : null;
}

/**
 * Where a status sits in the order, for rendering progress.
 * -1 for an unrecognised status, so a stray value sorts before everything
 * rather than silently reading as finished.
 */
export function ladderIndex(status: string | null | undefined): number {
  return SURVEY_LADDER.findIndex((d) => d.state === status);
}

/** Has the survey reached or passed this state? */
export function hasReached(status: string | null | undefined, state: SurveyState): boolean {
  const at = ladderIndex(status);
  return at >= 0 && at >= ladderIndex(state);
}
