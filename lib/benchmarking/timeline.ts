import type { TimelineStage } from "@/lib/elections/timeline";
import { SURVEY_LADDER, ladderIndex, type SurveyState } from "./lifecycle";

/**
 * The benchmarking cycle as one ordered list of stages.
 *
 * ⛔ Same shape as the election cycle, deliberately: TimelineStage and
 * StageState are IMPORTED, not retyped, and the same component renders both.
 * A second cycle that looked different would be a second thing to learn, and
 * this runs once a year — nobody ever stops learning it. The admin screen grew
 * a page at a time (drift, editor, flags, issues, notes, review, submissions,
 * trace) so its controls sit in the order they were built rather than the order
 * they happen, which is fine while you already know the process.
 *
 * Pure. Callers supply the facts and the date, exactly like
 * buildElectionTimeline.
 *
 * ⛔ Every action here already exists. A stage whose action had to be invented
 * would be a stage that cannot move, and a button that cannot succeed reads as
 * broken software rather than as a step not built yet. Where the work lives on
 * another screen the action is that path, not a handler.
 */

export interface BenchmarkingTimelineFacts {
  fiscalYear: number;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  /** Recipient queue: how many stores have a confirmed respondent. */
  recipientsTotal: number;
  recipientsConfirmed: number;
  /** How many people hold benchmarking.beta_tester right now. */
  betaTestersAppointed: number;
  /** Stores that have been mailed, and what has come back. */
  invited: number;
  drafts: number;
  submitted: number;
  /** Flagged figures still waiting on a verdict. */
  openFlags: number;
  /** Question review, which happens while the survey is still being written. */
  reviewDone: number;
  reviewTotal: number;
}

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export function buildBenchmarkingTimeline(
  facts: BenchmarkingTimelineFacts,
  today: string,
): TimelineStage[] {
  const at = ladderIndex(facts.status);
  /** Has the cycle moved past this state? */
  const past = (s: SurveyState) => at > ladderIndex(s);
  /** Is the cycle sitting in this state right now? */
  const now = (s: SurveyState) => facts.status === s;

  const opens = day(facts.opensAt);
  const closes = day(facts.closesAt);
  const stages: TimelineStage[] = [];

  // 1 — The questions, reviewed before anybody is asked them.
  const reviewComplete = facts.reviewTotal > 0 && facts.reviewDone >= facts.reviewTotal;
  stages.push({
    key: "question_review",
    label: "Question review",
    on: null,
    until: null,
    windowLabel: null,
    state: past("draft") ? "done" : reviewComplete ? "done" : "current",
    detail:
      facts.reviewTotal === 0
        ? "No questions are queued for review."
        : `${facts.reviewDone} of ${facts.reviewTotal} questions have a verdict.`,
    action: past("draft")
      ? null
      : { key: "openReview", label: "Open question review", blockedBy: null },
  });

  // 2 — Who the survey is addressed to. Nothing can be mailed without this.
  const recipientsReady = facts.recipientsTotal > 0 && facts.recipientsConfirmed >= facts.recipientsTotal;
  stages.push({
    key: "recipients",
    label: "Confirm who gets it",
    on: null,
    until: null,
    windowLabel: null,
    state: recipientsReady ? "done" : past("beta") ? "overdue" : "current",
    detail:
      facts.recipientsTotal === 0
        ? "The recipient queue has not been built."
        : `${facts.recipientsConfirmed} of ${facts.recipientsTotal} stores have a confirmed respondent.`,
    action: recipientsReady
      ? null
      : { key: "openQueue", label: "Open the queue", blockedBy: null },
  });

  // 3 — The people who go first. An APPOINTMENT, made where every other
  //     benchmarking job is handed out.
  stages.push({
    key: "appoint_testers",
    label: "Appoint the beta testers",
    on: null,
    until: null,
    windowLabel: null,
    state: facts.betaTestersAppointed > 0 ? "done" : past("beta") ? "not_applicable" : "current",
    detail:
      facts.betaTestersAppointed > 0
        ? `${facts.betaTestersAppointed} appointed. Appointing is what invites them.`
        : "Nobody is appointed, so nobody can open a survey that is still in draft.",
    action: past("beta")
      ? null
      : { key: "appoint", label: "Appoint someone", blockedBy: null },
  });

  // 4 — Beta testing.
  stages.push({
    key: "beta",
    label: "Beta testing",
    on: null,
    until: null,
    windowLabel: null,
    state: past("beta") ? "done" : now("beta") ? "current" : "upcoming",
    detail: now("beta")
      ? `${facts.submitted} submitted, ${facts.drafts} in progress.`
      : past("beta")
        ? "Finished."
        : "A handful of stores file for real, so a question that reads two ways is found before the whole membership meets it.",
    action: now("draft")
      ? {
          key: "startBeta",
          label: "Start beta testing",
          blockedBy:
            facts.betaTestersAppointed === 0
              ? "Appoint at least one beta tester first — nobody could open it."
              : null,
        }
      : null,
  });

  // 5 — Open to everyone.
  stages.push({
    key: "open",
    label: "Open to every store",
    on: opens,
    until: null,
    windowLabel: null,
    state: past("open") ? "done" : now("open") ? "current" : opens && today > opens ? "overdue" : "upcoming",
    detail: now("open")
      ? `${facts.submitted} of ${facts.recipientsTotal} stores have filed.`
      : opens
        ? `Planned for ${opens}.`
        : "No opening date set.",
    action: now("beta")
      ? { key: "openSurvey", label: "Open to everyone", blockedBy: null }
      : null,
  });

  // 6 — The invitation, and the chase. Both already live on the send panel.
  stages.push({
    key: "invitations",
    label: "Invite the stores",
    on: null,
    until: null,
    windowLabel: null,
    state: !now("open") && !past("open") ? "blocked" : facts.invited > 0 ? "done" : "current",
    detail:
      facts.invited > 0
        ? `${facts.invited} of ${facts.recipientsTotal} invited.`
        : "Nobody has been mailed yet.",
    action: now("open")
      ? { key: "openSendPanel", label: "Open the send panel", blockedBy: null }
      : null,
  });

  stages.push({
    key: "reminders",
    label: "Chase who has not filed",
    on: null,
    until: null,
    windowLabel: null,
    state: now("open") && facts.invited > 0 ? "current" : past("open") ? "done" : "upcoming",
    detail: `${Math.max(facts.recipientsTotal - facts.submitted, 0)} stores still outstanding.`,
    action: now("open")
      ? { key: "openReminders", label: "Send a reminder", blockedBy: null }
      : null,
  });

  // 7 — Close.
  stages.push({
    key: "closed",
    label: "Close the survey",
    on: closes,
    until: null,
    windowLabel: null,
    state: past("closed") ? "done" : now("closed") ? "current" : closes && today > closes ? "overdue" : "upcoming",
    detail: closes ? `Closes ${closes}.` : "No closing date set.",
    action: now("open") ? { key: "closeSurvey", label: "Close the survey", blockedBy: null } : null,
  });

  // 8 — Interpretation. Flagged figures get a human verdict before anything
  //     carrying a note reaches a report the whole membership reads.
  stages.push({
    key: "interpretation",
    label: "Resolve flagged figures",
    on: null,
    until: null,
    windowLabel: null,
    state: facts.openFlags === 0 ? (past("open") ? "done" : "upcoming") : "current",
    detail:
      facts.openFlags === 0
        ? "No flags waiting."
        : `${facts.openFlags} flag${facts.openFlags === 1 ? "" : "s"} waiting on a verdict.`,
    action:
      facts.openFlags > 0
        ? { key: "openFlagReview", label: "Open flag review", blockedBy: null }
        : null,
  });

  // 9 — Processing and publication, straight off the ladder.
  stages.push({
    key: "processing",
    label: "Build the report",
    on: null,
    until: null,
    windowLabel: null,
    state: past("processing") ? "done" : now("processing") ? "current" : "upcoming",
    detail: "The figures become the report the membership reads.",
    action: now("closed")
      ? { key: "beginProcessing", label: "Begin processing", blockedBy: facts.openFlags > 0 ? `${facts.openFlags} flagged figures still have no verdict.` : null }
      : null,
  });

  stages.push({
    key: "complete",
    label: "Published",
    on: null,
    until: null,
    windowLabel: null,
    state: now("complete") ? "done" : "upcoming",
    detail: "The cycle's figures are released and comparable.",
    action: now("processing") ? { key: "markComplete", label: "Mark complete", blockedBy: null } : null,
  });

  return stages;
}

/** The ladder states each timeline action moves the survey to. */
export const STAGE_TRANSITIONS: Record<string, SurveyState> = {
  startBeta: "beta",
  openSurvey: "open",
  closeSurvey: "closed",
  beginProcessing: "processing",
  markComplete: "complete",
};

/* Keeps the two in step: every transition names a state the ladder knows. */
export function transitionTargets(): SurveyState[] {
  return SURVEY_LADDER.map((d) => d.state).filter((s) =>
    Object.values(STAGE_TRANSITIONS).includes(s),
  );
}
