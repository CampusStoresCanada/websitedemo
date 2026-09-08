/**
 * MANY SCHEDULES, THEN PICK THE BEST — not one fill and go.
 *
 * ⛔ The greedy seed plus local search is ONE sample from a huge space, and its
 * quality depends heavily on the arbitrary order it happened to start from. A
 * single run is not "the answer", it is one draw. Steve: "you can't maximize on
 * one fill, you generate thousands and pick the best."
 *
 * This is the outer loop that makes that true. Each restart reseeds the whole
 * pipeline — greedy ordering, tiebreaks, fill order — scores the finished
 * schedule on the one objective, and the best draw wins.
 *
 * ⛔ DETERMINISTIC. Restart seeds are derived from the run's own seed, so the
 * same run reproduces the same schedule exactly. "Randomize" here means
 * exploring the space, never a result nobody can reproduce — a schedule you
 * cannot regenerate is one you cannot explain to a member who asks why.
 *
 * ⚠️ Embarrassingly parallel and CPU-bound: every restart is independent, and
 * the work is arithmetic over a few hundred thousand pairs. It wants a real
 * machine, not a short-lived cloud function.
 */
import type { ScheduleAssignment } from "./types";

export type RestartAttempt<T> = {
  seed: number;
  value: number;
  result: T;
};

export type RestartSpread = {
  restarts: number;
  best: number;
  worst: number;
  median: number;
  /**
   * How many DISTINCT objective values the restarts produced.
   *
   * ⚠️ THE NUMBER THAT SAYS WHETHER THIS IS WORTH THE COMPUTE. If every restart
   * lands on the same value, the search is effectively deterministic and the
   * extra draws bought nothing — either the space is genuinely flat or the seed
   * is not reaching the decisions it should. Spread of 1 is a finding, not a
   * success.
   */
  distinctValues: number;
};

export type RestartSearchResult<T> = {
  best: RestartAttempt<T>;
  spread: RestartSpread;
};

/**
 * Run `attempt` once per restart and keep the highest-scoring draw.
 *
 * Generic in the payload so this stays a pure loop over seeds and knows nothing
 * about schedules — the caller hands back whatever it needs from the winner.
 */
export function bestOfRestarts<T>(params: {
  baseSeed: number;
  restarts: number;
  attempt: (seed: number) => { value: number; result: T };
}): RestartSearchResult<T> {
  const restarts = Math.max(1, Math.floor(params.restarts));
  const attempts: RestartAttempt<T>[] = [];

  for (let i = 0; i < restarts; i += 1) {
    // Derived, not random: same run seed → same set of restarts → same winner.
    const seed = params.baseSeed + i;
    const { value, result } = params.attempt(seed);
    attempts.push({ seed, value, result });
  }

  const values = attempts.map((a) => a.value).sort((l, r) => l - r);
  const best = attempts.reduce((champion, attempt) =>
    // ⛔ Strictly greater, so the LOWEST seed wins a tie — otherwise a tie would
    // resolve on iteration order and the run would not be reproducible.
    attempt.value > champion.value ? attempt : champion
  );

  return {
    best,
    spread: {
      restarts,
      best: values[values.length - 1],
      worst: values[0],
      median: values[Math.floor(values.length / 2)],
      distinctValues: new Set(values).size,
    },
  };
}

/** Convenience for callers that only carry assignments through a restart. */
export type ScheduleDraw = { assignments: ScheduleAssignment[] };

export type ColdStopReason = "converged" | "draw_cap" | "time_budget";

export type ColdSearchResult<T> = RestartSearchResult<T> & {
  draws: number;
  stoppedBecause: ColdStopReason;
  /** Which draw last improved on the best — how long the tail actually was. */
  lastImprovementAt: number;
  elapsedMs: number;
};

/**
 * DRAW UNTIL IT STOPS FINDING BETTER — the stopping rule that matters.
 *
 * ⛔ "Solve it 200 times" is not the same question as "solve it until it stops
 * improving", and only the second is what a January freeze needs. A fixed count
 * either stops while the search is still climbing — throwing away a better
 * schedule nobody will know existed — or burns hours after it plateaued. Which
 * one you get is not knowable in advance, because it depends on the data.
 *
 * So: keep drawing while draws keep improving; stop when `patience` consecutive
 * draws fail to beat the best. Steve: "let it cool until it stops coming up with
 * better solves."
 *
 * ⚠️ PATIENCE IS THE REAL KNOB, and it is a statement about confidence rather
 * than speed: how many consecutive failures you accept as evidence that nothing
 * better remains. Too small stops on a lucky plateau; larger costs time and
 * finds the tail.
 *
 * ⛔ Both caps are BACKSTOPS, not targets. Reaching `maxDraws` or `maxMs` means
 * the search was STILL IMPROVING when it was cut off, and the result says so
 * explicitly — a truncated run must never be mistaken for a converged one.
 */
export function searchUntilCold<T>(params: {
  baseSeed: number;
  patience: number;
  maxDraws?: number;
  maxMs?: number;
  attempt: (seed: number) => { value: number; result: T };
  /** Called only when the best improves — progress on a long run. */
  onImprovement?: (info: { draw: number; value: number; elapsedMs: number }) => void;
  /** Injected so the loop is testable without a clock. */
  now?: () => number;
}): ColdSearchResult<T> {
  const now = params.now ?? (() => Date.now());
  const startedAt = now();
  const maxDraws = params.maxDraws ?? 100_000;
  const patience = Math.max(1, Math.floor(params.patience));

  const values: number[] = [];
  let best: RestartAttempt<T> | null = null;
  let sinceImprovement = 0;
  let lastImprovementAt = 0;
  let draws = 0;
  let stoppedBecause: ColdStopReason = "converged";

  while (draws < maxDraws) {
    const seed = params.baseSeed + draws;
    const { value, result } = params.attempt(seed);
    draws += 1;
    values.push(value);

    // ⛔ Strictly greater: an equal draw is NOT an improvement, or a plateau of
    // ties would keep the loop alive forever and never converge.
    if (!best || value > best.value) {
      best = { seed, value, result };
      sinceImprovement = 0;
      lastImprovementAt = draws;
      params.onImprovement?.({ draw: draws, value, elapsedMs: now() - startedAt });
    } else {
      sinceImprovement += 1;
    }

    if (sinceImprovement >= patience) {
      stoppedBecause = "converged";
      break;
    }
    if (params.maxMs !== undefined && now() - startedAt >= params.maxMs) {
      stoppedBecause = "time_budget";
      break;
    }
    if (draws >= maxDraws) {
      stoppedBecause = "draw_cap";
      break;
    }
  }

  const sorted = [...values].sort((l, r) => l - r);
  return {
    best: best!,
    draws,
    lastImprovementAt,
    stoppedBecause,
    elapsedMs: now() - startedAt,
    spread: {
      restarts: draws,
      best: sorted[sorted.length - 1],
      worst: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      distinctValues: new Set(sorted).size,
    },
  };
}
