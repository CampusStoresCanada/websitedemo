import { describe, expect, it, vi } from "vitest";
import { searchUntilCold } from "../search";

/**
 * "Let it cool until it stops coming up with better solves."
 *
 * ⛔ A fixed count and a convergence rule answer different questions. A count
 * either stops mid-climb — throwing away a better schedule nobody will know
 * existed — or burns hours after the plateau. Which one you get depends on the
 * data, so it cannot be chosen in advance.
 */
describe("searchUntilCold", () => {
  it("keeps drawing while draws keep improving", () => {
    // Improves for 20 draws, then flat forever.
    const attempt = (seed: number) => ({ value: Math.min(seed, 20), result: seed });
    const out = searchUntilCold({ baseSeed: 0, patience: 5, attempt });

    expect(out.best.value).toBe(20);
    expect(out.stoppedBecause).toBe("converged");
    expect(out.lastImprovementAt).toBe(21); // the draw that first hit 20
    expect(out.draws).toBe(26); // plus `patience` failures to confirm it
  });

  it("treats an EQUAL draw as a failure, or a plateau never converges", () => {
    /**
     * ⛔ Strictly-greater is what terminates. If ties counted as improvements,
     * a flat landscape — which is most of a saturated schedule — would reset
     * patience forever and the run would never end.
     */
    const out = searchUntilCold({
      baseSeed: 0,
      patience: 3,
      attempt: (seed) => ({ value: 100, result: seed }),
    });
    expect(out.stoppedBecause).toBe("converged");
    expect(out.draws).toBe(4);
    expect(out.best.seed).toBe(0);
  });

  it("says when it was CUT OFF rather than finished", () => {
    /**
     * ⚠️ A truncated run must never be mistaken for a converged one — reaching a
     * backstop means the search was still climbing when it was stopped, and the
     * schedule that produced it is not the best that exists.
     */
    const climbing = (seed: number) => ({ value: seed, result: seed });

    const capped = searchUntilCold({ baseSeed: 0, patience: 1000, maxDraws: 7, attempt: climbing });
    expect(capped.stoppedBecause).toBe("draw_cap");
    expect(capped.draws).toBe(7);

    let clock = 0;
    const timed = searchUntilCold({
      baseSeed: 0,
      patience: 1000,
      maxMs: 50,
      now: () => (clock += 10),
      attempt: climbing,
    });
    expect(timed.stoppedBecause).toBe("time_budget");
  });

  it("reports progress only when the best actually moves", () => {
    const onImprovement = vi.fn();
    searchUntilCold({
      baseSeed: 0,
      patience: 4,
      attempt: (seed) => ({ value: seed < 3 ? seed : 0, result: seed }),
      onImprovement,
    });
    // Draws 1,2,3 improve (0 → 1 → 2); everything after is a failure.
    expect(onImprovement).toHaveBeenCalledTimes(3);
  });

  it("is reproducible — same base seed, same winner", () => {
    const attempt = (seed: number) => ({ value: (seed * 31) % 17, result: seed });
    const a = searchUntilCold({ baseSeed: 5, patience: 10, attempt });
    const b = searchUntilCold({ baseSeed: 5, patience: 10, attempt });
    expect(a.best).toEqual(b.best);
    expect(a.draws).toBe(b.draws);
  });
});
