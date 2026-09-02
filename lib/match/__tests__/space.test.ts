import { describe, it, expect } from "vitest";
import {
  poolSignals,
  similarity,
  nearest,
  calibrate,
  placementConfidence,
  removeCommonDirection,
  rarityWeight,
  type SignalVector,
  type Placed,
} from "../space";

const v = (...xs: number[]) => xs;
const sig = (vector: number[], over: Partial<SignalVector> = {}): SignalVector => ({
  vector,
  verb: "posted",
  ...over,
});

const place = (id: string, vector: number[], mass = 10): Placed => ({
  id,
  vector,
  contributing: 1,
  mass,
});

describe("poolSignals", () => {
  it("returns null for nothing rather than a zero vector", () => {
    // A zero vector is equidistant from everything — a silent person would match
    // the entire roster at exactly the same score.
    expect(poolSignals([])).toBeNull();
  });

  it("returns null when every act decays below the floor", () => {
    const ancient = new Date("2001-01-01");
    const now = new Date("2026-01-01");
    expect(poolSignals([sig(v(1, 0), { occurredAt: ancient })], { now })).toBeNull();
  });

  it("places an entity between its signals, weighted", () => {
    const out = poolSignals([sig(v(1, 0)), sig(v(0, 1))]);
    expect(out).not.toBeNull();
    // Equal weight, orthogonal: lands on the diagonal.
    expect(out!.vector[0]).toBeCloseTo(out!.vector[1], 6);
    expect(out!.contributing).toBe(2);
  });

  it("weights a stronger act nearer to itself", () => {
    const out = poolSignals([sig(v(1, 0), { weight: 10 }), sig(v(0, 1), { weight: 1 })]);
    expect(out!.vector[0]).toBeGreaterThan(out!.vector[1]);
  });

  it("normalizes, so volume does not become position", () => {
    // Somebody who says the same thing fifty times must not out-rank somebody
    // who said it once — loudness belongs in confidence, not in direction.
    const once = poolSignals([sig(v(1, 0))])!;
    const fifty = poolSignals(Array.from({ length: 50 }, () => sig(v(1, 0))))!;
    expect(similarity(once.vector, fifty.vector)).toBeCloseTo(1, 6);
    expect(fifty.mass).toBeGreaterThan(once.mass);
  });

  it("decays an old act below a recent one", () => {
    const now = new Date("2026-01-01");
    const recent = poolSignals(
      [sig(v(1, 0), { occurredAt: new Date("2025-12-25") }), sig(v(0, 1), { occurredAt: new Date("2020-01-01") })],
      { now }
    )!;
    expect(recent.vector[0]).toBeGreaterThan(recent.vector[1]);
  });

  it("ignores a vector of the wrong width rather than mixing models", () => {
    const out = poolSignals([sig(v(1, 0)), sig(v(1, 0, 0))])!;
    expect(out.contributing).toBe(1);
  });

  it("pushes AWAY on a negative weight", () => {
    // Invited and did not go; said a vendor let them down. Without this the only
    // opinion the model can express is enthusiasm.
    const out = poolSignals([sig(v(1, 0), { weight: 3 }), sig(v(0, 1), { weight: -1 })])!;
    expect(out.vector[0]).toBeGreaterThan(0);
    expect(out.vector[1]).toBeLessThan(0);
  });

  it("counts a negative act as evidence, not as ignorance", () => {
    const positive = poolSignals([sig(v(1, 0), { weight: 2 })])!;
    const negative = poolSignals([sig(v(1, 0), { weight: -2 })])!;
    expect(negative.mass).toBe(positive.mass);
    expect(negative.contributing).toBe(1);
  });

  it("decays a negative act toward zero, never through it", () => {
    const now = new Date("2026-01-01");
    const fresh = poolSignals([sig(v(1, 0), { weight: -1, occurredAt: new Date("2025-12-30") })], { now })!;
    // Still pointing away, just less so — a stale complaint must not become praise.
    expect(fresh.vector[0]).toBeLessThan(0);
  });

  it("returns null when signals cancel exactly", () => {
    // Pulled equally toward and away: genuinely unplaceable, not the origin.
    expect(poolSignals([sig(v(1, 0), { weight: 1 }), sig(v(1, 0), { weight: -1 })])).toBeNull();
  });

  it("treats an undated act at full weight rather than decaying it to nothing", () => {
    // Declared data on this site carries no timestamp. Undated must not mean old.
    const out = poolSignals([sig(v(1, 0), { occurredAt: null, weight: 1 })]);
    expect(out).not.toBeNull();
  });
});

describe("nearest", () => {
  const subject = place("me", [1, 0]);
  const candidates = [
    place("same", [1, 0]),
    place("near", [0.9, 0.44]),
    place("far", [0, 1]),
    place("me", [1, 0]),
  ];

  it("orders by similarity and never returns the subject", () => {
    const out = nearest(subject, candidates);
    expect(out.map((n) => n.id)).toEqual(["same", "near", "far"]);
    expect(out[0].similarity).toBeGreaterThan(out[2].similarity);
  });

  it("is deterministic when scores tie", () => {
    // ~40% of real pairs tie exactly; without a stable tiebreak the schedule
    // changes between identical runs and reads as instability.
    const tied = [place("b", [1, 0]), place("a", [1, 0]), place("c", [1, 0])];
    expect(nearest(subject, tied).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(nearest(subject, [...tied].reverse()).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("honours k and the similarity floor", () => {
    expect(nearest(subject, candidates, { k: 1 })).toHaveLength(1);
    expect(nearest(subject, candidates, { minSimilarity: 0.5 }).map((n) => n.id)).toEqual([
      "same",
      "near",
    ]);
  });
});

describe("calibrate", () => {
  const sims = [0.1, 0.2, 0.3, 0.4, 0.5];

  it("is monotone, so it can never reorder a ranking", () => {
    const f = calibrate(sims);
    const ys = [-1, 0.1, 0.25, 0.5, 9].map(f);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
  });

  it("spans the run rather than a band fixed by hand", () => {
    // The bug this replaces: a hard-coded 0.3..0.9 band clamped 98% of a
    // centred run to zero, leaving 68 distinct scores across 6,000 pairs.
    const centred = calibrate([-0.17, -0.04, 0.03, 0.12, 0.39]);
    expect(centred(-0.17)).toBe(0);
    expect(centred(0.39)).toBeGreaterThan(50);
    expect(new Set([-0.17, -0.04, 0.03, 0.12, 0.39].map(centred)).size).toBe(5);
  });

  it("handles a run where everything is identical", () => {
    expect(calibrate([0.5, 0.5, 0.5])(0.5)).toBe(50);
    expect(calibrate([])(0.5)).toBe(0);
  });
});

describe("placementConfidence", () => {
  it("rises with evidence and saturates", () => {
    const a = placementConfidence(place("a", [1, 0], 1));
    const b = placementConfidence(place("b", [1, 0], 100));
    const c = placementConfidence(place("c", [1, 0], 200));
    expect(a).toBeLessThan(b);
    expect(c - b).toBeLessThan(b - a);
    expect(c).toBeLessThan(1);
  });

  it("is independent of position — near is not the same as known", () => {
    expect(placementConfidence(place("a", [1, 0], 10))).toBe(
      placementConfidence(place("b", [0, 1], 10))
    );
  });
});

describe("removeCommonDirection", () => {
  it("spreads out entities that all shared a dominant direction", () => {
    // Everything leans hard on axis 0 (the "this is all campus-store text"
    // direction) and differs only slightly on 1 and 2. Raw cosine says they are
    // all nearly identical; after centring, the differences are what remain.
    const raw = [
      place("a", normalizeVec([10, 1, 0])),
      place("b", normalizeVec([10, 0, 1])),
      place("c", normalizeVec([10, 1, 0.1])),
    ];
    const before = similarity(raw[0].vector, raw[1].vector);
    const after = removeCommonDirection(raw);
    const spread = similarity(after[0].vector, after[1].vector);
    expect(before).toBeGreaterThan(0.9);
    expect(spread).toBeLessThan(before);
  });

  it("keeps the nearer pair nearer — it removes genericness, not order", () => {
    const raw = [
      place("a", normalizeVec([10, 1, 0])),
      place("b", normalizeVec([10, 0.9, 0])),
      place("c", normalizeVec([10, -1, 0])),
    ];
    const [a, b, c] = removeCommonDirection(raw);
    expect(similarity(a.vector, b.vector)).toBeGreaterThan(similarity(a.vector, c.vector));
  });

  it("passes through a population too small to have a common direction", () => {
    const raw = [place("a", [1, 0]), place("b", [0, 1])];
    expect(removeCommonDirection(raw)).toHaveLength(2);
  });
});

describe("rarityWeight", () => {
  it("gives a rare act more weight than a universal one", () => {
    expect(rarityWeight(5, 300)).toBeGreaterThan(rarityWeight(200, 300));
  });

  it("never returns zero for an act everyone shared", () => {
    // Uninformative is not the same as "did not happen".
    expect(rarityWeight(300, 300)).toBeGreaterThan(0);
  });

  it("falls monotonically as more people share it", () => {
    const ws = [1, 5, 25, 100, 284].map((n) => rarityWeight(n, 284));
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeLessThan(ws[i - 1]);
  });

  it("is safe on degenerate input", () => {
    expect(rarityWeight(0, 100)).toBe(1);
    expect(rarityWeight(10, 0)).toBe(1);
  });
});

function normalizeVec(xs: number[]): number[] {
  const n = Math.sqrt(xs.reduce((s, x) => s + x * x, 0));
  return xs.map((x) => x / n);
}
