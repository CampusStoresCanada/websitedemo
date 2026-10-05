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

/**
 * When an appointment to a benchmarking capability should lapse.
 *
 * ⛔ A rule, declared once, not a date somebody types per person. Every
 * appointment asked the operator to invent an end date with nothing checking it
 * against the cycle, so a beta tester could be given access that expired while
 * the survey was still in beta, and a reviewer could keep access to a finished
 * one. The cycle already knows when its work ends.
 *
 * ⚠️ term_end is EXCLUSIVE — capability_contributions tests
 * `term_end > CURRENT_DATE`, evaluated in UTC. So this returns the day AFTER
 * their last, and the caller must not subtract one "to be safe". Twelve
 * question reviewers held term_end 2026-10-01 and lost access at 6pm Mountain
 * on September 30, which is what that mistake looks like.
 */
export function termEndsFor(
  capability: string,
  survey: { closesAt: string | null; opensAt: string | null },
): string | null {
  const dayAfter = (iso: string) => {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  switch (capability) {
    /*
      Reviewers are done when the questions are fixed, which is when the survey
      opens — but they keep access through the opening day rather than losing
      it the evening before, because a reviewer checking their own wording on
      the morning it goes live is the point.
    */
    case CAPABILITIES.BENCHMARKING_CONTENT_REVIEW:
      return survey.opensAt ? dayAfter(survey.opensAt) : null;

    /*
      A beta tester files a real submission and may amend it, so their access
      has to outlast the beta phase. Ends with the survey.
    */
    case CAPABILITIES.BENCHMARKING_BETA_TESTER:
    case CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM:
      return survey.closesAt ? dayAfter(survey.closesAt) : null;

    /*
      Interpretation starts when collection closes, so it cannot end there.
      Deliberately NOT derived — the committee decides when its reading is
      finished, and guessing a date here would expire somebody mid-judgement.
    */
    case CAPABILITIES.BENCHMARKING_QA_VERIFY:
    case CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD:
    default:
      return null;
  }
}

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

/**
 * The chase: when a store that has not filed is reminded.
 *
 * ⛔ Steps, not a bare list of day-numbers. `[30, 14, 7, 3, 1]` is fine for a
 * machine and useless to the person deciding whether the association is being
 * persistent or being a nuisance — it says nothing about what dates those land
 * on, who receives them, or whether two collide. lib/elections/reminders.ts
 * turns steps like these into dated, working-day-adjusted plans, and
 * benchmarking uses that rather than becoming a third implementation beside it
 * and the renewal series.
 *
 * ⚠️ Counted back from the LAST DAY A STORE CAN FILE, not from `closes_at`.
 * closes_at is an exclusive boundary one day later, so counting from it would
 * put every reminder a day late and the final one on a closed survey. See
 * deadline.ts.
 *
 * ⛔ NOT snapshotted onto the survey row, unlike ElectionsConfig. It should be —
 * changing 2027's cadence must not rewrite what 2026 claims it did — but that
 * needs a column, and a migration against benchmarking tables is exactly what
 * the live-cycle rule in CLAUDE.md forbids while stores are filing. Snapshot it
 * when the cycle closes.
 */
export const BENCHMARKING_REMINDERS = {
  enabled: true,
  /** Gaps here are 16, 7, 4 and 2 days, so 2 is the floor this series allows. */
  minimumGapDays: 2,
  steps: [
    { daysBeforeClose: 30, label: "A month to go", audience: "not_filed" },
    { daysBeforeClose: 14, label: "Two weeks to go", audience: "not_filed" },
    { daysBeforeClose: 7, label: "A week to go", audience: "not_filed" },
    { daysBeforeClose: 3, label: "Three days to go", audience: "not_filed" },
    { daysBeforeClose: 1, label: "Closes tomorrow", audience: "not_filed" },
  ],
} as const;
