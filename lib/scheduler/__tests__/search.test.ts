import { describe, expect, it } from "vitest";
import { bestOfRestarts } from "../search";
import { DEFAULT_ILS } from "../run-search";
import { DEFAULT_PREFERENCE_PERCENTILE } from "../objective";

/**
 * The outer loop: many draws, keep the best.
 *
 * ⛔ Reproducibility is the constraint that makes this usable. "Randomize" here
 * means exploring the space, never producing a schedule nobody can regenerate —
 * a member asking why they got these five meetings deserves an answer, and
 * "the dice" is not one.
 */
describe("bestOfRestarts", () => {
  it("keeps the highest-scoring draw, not the last or the first", () => {
    const result = bestOfRestarts({
      baseSeed: 100,
      restarts: 5,
      attempt: (seed) => ({ value: seed === 102 ? 999 : seed, result: seed }),
    });
    expect(result.best.value).toBe(999);
    expect(result.best.seed).toBe(102);
  });

  it("is reproducible — same base seed, same winner", () => {
    const attempt = (seed: number) => ({ value: (seed * 37) % 11, result: seed });
    const a = bestOfRestarts({ baseSeed: 7, restarts: 8, attempt });
    const b = bestOfRestarts({ baseSeed: 7, restarts: 8, attempt });
    expect(a.best).toEqual(b.best);
  });

  it("breaks a tie on the LOWEST seed, never on iteration order", () => {
    // Otherwise two runs of identical input could disagree about the winner.
    const result = bestOfRestarts({
      baseSeed: 1,
      restarts: 4,
      attempt: (seed) => ({ value: 50, result: seed }),
    });
    expect(result.best.seed).toBe(1);
  });

  it("reports the spread, so a flat search is visible", () => {
    /**
     * ⚠️ distinctValues === 1 is the number that says the compute bought
     * nothing — every restart landed on the same schedule value. That is a
     * finding about the search, not a success.
     */
    const flat = bestOfRestarts({
      baseSeed: 1,
      restarts: 6,
      attempt: (seed) => ({ value: 42, result: seed }),
    });
    expect(flat.spread.distinctValues).toBe(1);
    expect(flat.spread.best).toBe(42);
    expect(flat.spread.worst).toBe(42);

    const varied = bestOfRestarts({
      baseSeed: 1,
      restarts: 6,
      attempt: (seed) => ({ value: seed, result: seed }),
    });
    expect(varied.spread.distinctValues).toBe(6);
    expect(varied.spread.best).toBeGreaterThan(varied.spread.worst);
  });

  it("always runs at least once", () => {
    const result = bestOfRestarts({
      baseSeed: 5,
      restarts: 0,
      attempt: (seed) => ({ value: 1, result: seed }),
    });
    expect(result.spread.restarts).toBe(1);
    expect(result.best.seed).toBe(5);
  });
});

describe("search defaults", () => {
  /**
   * ⛔ THESE ARE DECISIONS, NOT CONVENIENCES — pinned so neither drifts back
   * without someone noticing. Both were set by Steve on 2026-09-08 from measured
   * convergence runs, not from preference:
   *
   *   ILS on   — restarts reached 72,397 in 54 draws over 83 minutes; ILS
   *              reached 82,524 in 262 draws over 21 minutes, at the same
   *              preference weight. +14% in a quarter of the time, 75 more
   *              requests honoured. Restarts threw away 51 of 54 draws.
   *
   *   p90      — the same converged run honoured 486 requests instead of 475,
   *              with fit quality and occupancy both slightly up. Most of the
   *              raw objective difference was the preference term counting for
   *              more, so the eleven extra granted meetings are the real gain.
   */
  it("runs iterated local search unless explicitly disabled", () => {
    expect(DEFAULT_ILS.strength).toBe(6);
  });

  it("values a stated pick at the top decile of the run's own scores", () => {
    expect(DEFAULT_PREFERENCE_PERCENTILE).toBe(0.9);
  });
});
