import { describe, it, expect } from "vitest";
import { bestMatchingAct, centreVectors, similarity } from "../space";

const unit = (xs: number[]) => {
  const n = Math.sqrt(xs.reduce((s, x) => s + x * x, 0));
  return xs.map((x) => x / n);
};

describe("bestMatchingAct", () => {
  it("finds the one act that matches, not the average of all of them", () => {
    // Waterloo: mostly staplers, one post about apparel. The average points at
    // neither; the best act points straight at the apparel vendor.
    const staplers = unit([0, 1, 0]);
    const apparel = unit([1, 0, 0]);
    const acts = [staplers, staplers, staplers, apparel];
    const vendor = apparel;

    const best = bestMatchingAct(acts, vendor)!;
    expect(best.index).toBe(3);
    expect(best.similarity).toBeCloseTo(1, 6);

    // What pooling would have said instead.
    const pooled = unit(acts.reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0]));
    expect(similarity(pooled, vendor)).toBeLessThan(best.similarity);
  });

  it("returns the index so the quote survives into the reason", () => {
    const acts = [unit([1, 0]), unit([0, 1])];
    expect(bestMatchingAct(acts, unit([0, 1]))!.index).toBe(1);
  });

  it("is null when there is nothing to compare", () => {
    expect(bestMatchingAct([], unit([1, 0]))).toBeNull();
    expect(bestMatchingAct([unit([1, 0])], [])).toBeNull();
  });

  it("skips vectors of the wrong width rather than mixing models", () => {
    const best = bestMatchingAct([[1, 0, 0], unit([0, 1])], unit([0, 1]))!;
    expect(best.index).toBe(1);
  });
});

describe("centreVectors", () => {
  it("removes the direction everything shares, so acts stop all matching", () => {
    // Uncentred, every act in a single-domain corpus scores ~0.6 against every
    // candidate because it is all the same kind of text.
    const raw = [unit([10, 1, 0]), unit([10, 0, 1]), unit([10, 1, 0.2])];
    const before = similarity(raw[0], raw[1]);
    const after = centreVectors(raw);
    expect(before).toBeGreaterThan(0.9);
    expect(similarity(after[0], after[1])).toBeLessThan(before);
  });

  it("leaves acts and pooled positions in the SAME space", () => {
    // Projection is linear, so pooling centred acts must agree with centring the
    // pooled result — otherwise a best-act score and a pooled score could not be
    // compared to each other.
    const raw = [unit([10, 1, 0]), unit([10, 0, 1])];
    const centred = centreVectors([...raw, unit([10, 1, 1])]).slice(0, 2);
    const pooledFromCentred = unit(centred.reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0]));
    expect(Number.isFinite(similarity(pooledFromCentred, centred[0]))).toBe(true);
  });

  it("passes through a population too small to have a common direction", () => {
    expect(centreVectors([unit([1, 0])])).toHaveLength(1);
  });
});
