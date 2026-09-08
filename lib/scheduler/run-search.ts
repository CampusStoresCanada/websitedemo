/**
 * THE SEARCH ITSELF, callable from anywhere.
 *
 * ⛔ Extracted so the scheduler is not welded to an HTTP request. It lived
 * inside `createSchedulerDraftRun`, tangled with auth and DB writes, which meant
 * the only way to run a schedule was to click a button and wait inside a request
 * timeout. That is the wrong container for the work: drawing many schedules is
 * pure arithmetic, embarrassingly parallel, and wants a real machine.
 *
 * ⛔ ONE IMPLEMENTATION, TWO CALLERS. The server action and the local CLI both
 * call this. Rebuilding the assembly (seat facts, legality, objective lookups)
 * in a script would be the same duplication this codebase has already paid for
 * in seat readers, score sources and candidate lists — a local run that
 * disagreed with the button would be worse than no local run.
 */
import { generateSchedule } from "./generate";
import { optimizeSchedule, perturbSchedule } from "./optimize";
import {
  bestOfRestarts,
  searchUntilCold,
  type ColdSearchResult,
  type ColdStopReason,
  type RestartSpread,
} from "./search";
import { isBlackedOut } from "./blackout";
import { validateScheduleConstraints } from "./constraints";
import { describeTotals } from "./objective";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MatchScoreRecord,
  MeetingSlotInput,
  SchedulerDiagnosticReport,
  ScheduleAssignment,
  SchedulingPolicy,
} from "./types";

/**
 * How far a perturbation moves the incumbent — how many random legal swaps.
 *
 * ⚠️ 6 is what every measured ILS run used. Smaller barely leaves the local
 * optimum; larger drifts toward a plain restart and loses the advantage.
 */
export const DEFAULT_ILS = { strength: 6 } as const;

export type SearchInputs = {
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
  meetingSlots: MeetingSlotInput[];
  matchScores: MatchScoreRecord[];
  policy: SchedulingPolicy;
  suitePinnedExhibitorBySuiteId: Record<string, string>;
  /** Seat → the org they attend for, and who they are. */
  delegateSeats: ReadonlyMap<string, { orgId: string; contactId: string | null }>;
  exhibitorSeats: ReadonlyMap<string, { orgId: string; suiteId: string }>;
  orgTotalFor: (memberOrgId: string, partnerOrgId: string) => number;
  personTotalFor: (memberContactId: string, partnerOrgId: string) => number;
  orgPreferredFor: (declaringOrgId: string, chosenOrgId: string) => boolean;
  personPreferredFor: (declaringContactId: string, chosenOrgId: string) => boolean;
  /** Every org-grain total on the run — the distribution the weight comes from. */
  orgTotals: number[];
  seed: number;
  /**
   * How many schedules to draw — WIDTH.
   *
   * ⚠️ Ignored when `untilCold` is set. A fixed count answers "solve it N times";
   * the freeze needs "solve it until it stops improving", a different question
   * with a different answer.
   */
  restarts: number;
  /**
   * Draw until `patience` consecutive draws fail to improve, instead of a count.
   * `maxDraws` / `maxMs` are backstops so an overnight run cannot be endless.
   */
  untilCold?: { patience: number; maxDraws?: number; maxMs?: number };
  onImprovement?: (info: { draw: number; value: number; elapsedMs: number }) => void;
  /**
   * ITERATED LOCAL SEARCH — ON BY DEFAULT. Perturb the best schedule so far
   * rather than drawing a fresh one; `strength` is how many random legal swaps
   * to apply before re-optimising.
   *
   * ⛔ Pass `false` only to reproduce a pre-2026-09-08 run. Measured on
   * identical converged runs at the same preference weight: restarts reached
   * 72,397 in 54 draws over 83 minutes, ILS reached 82,524 in 262 draws over 21
   * minutes — +14% in a quarter of the time, and 75 more requests honoured.
   * Restarts spend every draw rediscovering quality from nothing: 51 of their
   * 54 finished worse than a schedule already in hand and were thrown away.
   */
  ils?: { strength: number } | false;
  /** Percentile a stated pick is worth, passed to describeTotals. Default 0.75. */
  preferencePercentile?: number;
  /**
   * How many delegate-pair swaps each draw may examine per pass — DEPTH.
   *
   * ⚠️ A different lever from `restarts`, and they trade against each other for
   * a fixed compute budget: width samples more starting points, depth explores
   * further from each one. Which pays more is an empirical question about the
   * score distribution, not something to assume.
   */
  maxSwapTrials?: number;
};

export type SearchOutcome = {
  assignments: ScheduleAssignment[];
  diagnostics: SchedulerDiagnosticReport;
  spread: RestartSpread;
  /** Set when the run used convergence rather than a fixed count. */
  draws?: number;
  stoppedBecause?: ColdStopReason;
  lastImprovementAt?: number;
  elapsedMs?: number;
  winningSeed: number;
  objectiveValue: number;
  satisfiedPreferences: number;
  mutualPreferences: number;
  preferenceShare: number;
  preferenceWeight: number;
  rescueMoves: number;
  scoreDistribution: ReturnType<typeof describeTotals>;
};

/**
 * ⛔ THIS NEVER RUNS IN THE CLOUD.
 *
 * Guarded at the COMPUTE, not at one entry point, so no future caller can
 * reopen the path by accident. `createSchedulerDraftRun` is a Next.js server
 * action: on a developer's machine it runs locally, but deployed it would solve
 * on Vercel — inside a request timeout, on rented CPU, for a job that is pure
 * arithmetic and wants to run until it stops improving.
 *
 * Steve: "it should never even have the chance to deploy to vercel... I have a
 * nice free (already paid for) $6,000 mac sitting here waiting to eat numbers."
 *
 * A thrown error is deliberate. Falling back to a small search would produce a
 * worse schedule silently, which is the failure mode this codebase keeps
 * finding — better a run that refuses and names the command that works.
 */
function refuseCloudExecution(): void {
  // Vercel sets this in every runtime it owns (build, serverless, edge).
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error(
      "SCHEDULER_IS_LOCAL_ONLY: schedule generation is deliberately not available " +
        "in a deployed environment. Run it on the machine that owns this conference: " +
        "npx tsx --env-file=.env.local scripts/schedule-search.ts <conferenceId> --persist"
    );
  }
}

export function runSchedulerSearch(input: SearchInputs): SearchOutcome {
  refuseCloudExecution();
  const scoreDistribution = describeTotals(input.orgTotals, input.preferencePercentile);
  const delegateById = new Map(input.delegates.map((d) => [d.registrationId, d]));
  const exhibitorBySeat = new Map(input.exhibitors.map((e) => [e.registrationId, e]));

  const generateInput = {
    delegates: input.delegates,
    exhibitors: input.exhibitors,
    meetingSlots: input.meetingSlots,
    matchScores: input.matchScores,
    policy: input.policy,
    suitePinnedExhibitorBySuiteId: input.suitePinnedExhibitorBySuiteId,
    seed: input.seed,
  };

  const optimizeContext = {
    meetingSlots: input.meetingSlots,
    policy: {
      meetingGroupMin: input.policy.meetingGroupMin,
      meetingGroupMax: input.policy.meetingGroupMax,
    },
    exhibitorSeats: input.exhibitorSeats,
    delegateSeats: input.delegateSeats,
    // ⛔ Legality is a filter on moves, never a term.
    mayMeet: (delegateSeatId: string, exhibitorSeatId: string) => {
      const delegate = delegateById.get(delegateSeatId);
      const exhibitor = exhibitorBySeat.get(exhibitorSeatId);
      if (!delegate || !exhibitor) return false;
      return !isBlackedOut(delegate, exhibitor);
    },
    objective: {
      delegateSeats: input.delegateSeats,
      exhibitorSeats: input.exhibitorSeats,
      orgTotalFor: input.orgTotalFor,
      personTotalFor: input.personTotalFor,
      orgPreferredFor: input.orgPreferredFor,
      personPreferredFor: input.personPreferredFor,
      preferenceWeight: scoreDistribution.weight,
    },
    seed: input.seed,
    maxSwapTrials: input.maxSwapTrials,
  };

  /**
   * The best schedule found so far, kept ONLY for iterated local search.
   *
   * ⛔ Restarts have no memory by design, and that is their weakness: measured
   * on a converged run, 51 of 54 draws started cold, took ~92 seconds each, and
   * finished worse than a schedule already in hand. With `ils` set, a draw
   * begins from the incumbent, disturbed, so that time is spent near the good
   * answer instead of re-rolling.
   *
   * Updated inside `attempt` because the search calls it strictly in sequence.
   */
  let incumbent: ScheduleAssignment[] | null = null;
  let incumbentValue = Number.NEGATIVE_INFINITY;
  // The first draw always seeds from the greedy — there is nothing to perturb
  // yet, and its diagnostics carry the targets the constraint report needs.
  let firstDraw: ReturnType<typeof generateSchedule> | null = null;

  const attempt = (seed: number) => {
    const ils = input.ils === undefined ? DEFAULT_ILS : input.ils;
    const useIls = ils !== false && incumbent !== null;
    const start = useIls
      ? perturbSchedule(incumbent!, { ...optimizeContext, seed }, seed, ils.strength)
      : generateSchedule({ ...generateInput, seed }).assignments;
    if (!firstDraw) firstDraw = generateSchedule({ ...generateInput, seed });

    const improved = optimizeSchedule(start, { ...optimizeContext, seed });
    if (improved.after.value > incumbentValue) {
      incumbentValue = improved.after.value;
      incumbent = improved.assignments;
    }
    return { value: improved.after.value, result: { draw: firstDraw!, improved } };
  };

  const search = input.untilCold
    ? searchUntilCold({
        baseSeed: input.seed,
        patience: input.untilCold.patience,
        maxDraws: input.untilCold.maxDraws,
        maxMs: input.untilCold.maxMs,
        onImprovement: input.onImprovement,
        attempt,
      })
    : bestOfRestarts({ baseSeed: input.seed, restarts: input.restarts, attempt });

  // Narrowed explicitly: only the convergence path carries the tail figures,
  // and a caller reading them off a fixed-count run would be reading nothing.
  type Draw = { draw: ReturnType<typeof generateSchedule>; improved: ReturnType<typeof optimizeSchedule> };
  const cold: ColdSearchResult<Draw> | null =
    "stoppedBecause" in search ? (search as ColdSearchResult<Draw>) : null;
  const { draw, improved } = search.best.result;

  /**
   * ⛔ DIAGNOSTICS DESCRIBE THE SCHEDULE WE ARE KEEPING, not the greedy seed.
   *
   * This returned `draw.diagnostics`, computed by `generateSchedule` BEFORE the
   * optimizer touched anything — and the optimizer changes a great deal, moving
   * from ~44% to ~75% occupancy and reshaping every group. So every constraint
   * violation persisted on a run described a schedule that was never saved.
   *
   * That silently invalidated all three coverage gates: PERSON_COVERAGE,
   * DELEGATE_TARGET and ORG_COVERAGE were each answering a question about the
   * wrong assignments. Recomputed here against the winner.
   */
  const diagnostics = validateScheduleConstraints({
    meetingSlots: input.meetingSlots,
    assignments: improved.assignments,
    delegates: input.delegates,
    exhibitors: input.exhibitors,
    delegateTargetMeetings: draw.diagnostics.delegateTargetMeetings,
    // Same derivation generate.ts uses: the grid divided among the exhibitors.
    exhibitorTargetMeetings: Math.max(
      1,
      Math.floor(input.meetingSlots.length / Math.max(1, input.exhibitors.length))
    ),
    policy: input.policy,
  });

  return {
    assignments: improved.assignments,
    diagnostics,
    spread: search.spread,
    draws: cold?.draws,
    stoppedBecause: cold?.stoppedBecause,
    lastImprovementAt: cold?.lastImprovementAt,
    elapsedMs: cold?.elapsedMs,
    winningSeed: search.best.seed,
    objectiveValue: improved.after.value,
    satisfiedPreferences: improved.after.satisfiedPreferences,
    mutualPreferences: improved.after.mutualPreferences,
    preferenceShare: improved.after.preferenceShare,
    preferenceWeight: improved.after.preferenceWeight,
    rescueMoves: improved.movesApplied.rescue,
    scoreDistribution,
  };
}
