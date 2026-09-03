import { describe, expect, it } from "vitest";
import { normalize, dot, kmeans, centroid, representatives } from "../embedding";

/** Three tight groups in 3-space, so cluster membership is knowable by hand. */
const GROUPS = [
  [[1, 0, 0], [0.99, 0.05, 0], [0.98, 0.1, 0.02]],
  [[0, 1, 0], [0.05, 0.99, 0], [0.02, 0.98, 0.1]],
  [[0, 0, 1], [0, 0.05, 0.99], [0.1, 0.02, 0.98]],
].flat().map(normalize);

describe("normalize / dot", () => {
  it("makes the dot product a cosine", () => {
    expect(dot(normalize([3, 0, 0]), normalize([9, 0, 0]))).toBeCloseTo(1);
    expect(dot(normalize([1, 0, 0]), normalize([0, 1, 0]))).toBeCloseTo(0);
  });

  it("survives a zero vector instead of dividing by zero", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("kmeans", () => {
  it("recovers groups that are actually separate", () => {
    const clusters = kmeans(GROUPS, 3);
    expect(clusters).toHaveLength(3);
    for (const c of clusters) {
      // Every member of a recovered cluster came from the same original group.
      const groups = new Set(c.members.map((i) => Math.floor(i / 3)));
      expect(groups.size).toBe(1);
    }
  });

  it("⚠️ is deterministic — a human is about to label this", () => {
    // Random seeding would give a different clustering on the next run, and the
    // labels would then describe a world that no longer exists.
    const a = kmeans(GROUPS, 3).map((c) => c.members.join(","));
    const b = kmeans(GROUPS, 3).map((c) => c.members.join(","));
    expect(a).toEqual(b);
  });

  it("reports cohesion, so an incoherent cluster is visible", () => {
    const tight = kmeans(GROUPS, 3)[0];
    expect(tight.cohesion).toBeGreaterThan(0.99);

    // One cluster forced over three orthogonal groups cannot be coherent.
    const forced = kmeans(GROUPS, 1)[0];
    expect(forced.cohesion).toBeLessThan(0.7);
  });

  it("never returns an empty cluster, and asks for no more than it has", () => {
    expect(kmeans(GROUPS, 99).every((c) => c.members.length > 0)).toBe(true);
    expect(kmeans([], 5)).toEqual([]);
  });

  it("picks the most central member as the one to show a human", () => {
    const clusters = kmeans(GROUPS, 3);
    for (const c of clusters) {
      const mid = centroid(GROUPS, c.members);
      const best = representatives(c, GROUPS, mid, 1)[0];
      expect(best).toBe(c.medoid);
    }
  });
});
