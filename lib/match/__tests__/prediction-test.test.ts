import { describe, it, expect } from "vitest";
import { scorePredictions, chanceOverlap, type PickSet, type Prediction } from "../prediction-test";

const pick = (o: Partial<PickSet> = {}): PickSet => ({
  subjectId: "ana",
  chosen: ["rains", "dynasty", "ironhead", "barbarian", "cocoburry"],
  pickedAt: new Date("2026-10-01"),
  chosenFrom: "browse",
  ...o,
});
const predicted = (o: Partial<Prediction> = {}): Prediction => ({
  subjectId: "ana",
  predicted: ["rains", "dynasty", "sparta", "craftwell", "itoya"],
  predictedAt: new Date("2026-09-15"),
  ...o,
});

describe("chanceOverlap", () => {
  it("is the number a result has to beat to mean anything", () => {
    // Five picks against our five, from 80 partners present.
    expect(chanceOverlap(5, 5, 80)).toBeCloseTo(0.3125, 4);
  });
  it("is zero with nothing to pick from", () => {
    expect(chanceOverlap(5, 5, 0)).toBe(0);
  });
});

describe("scorePredictions", () => {
  it("counts the overlap and names what we missed", () => {
    const s = scorePredictions([pick()], [predicted()], 80);
    expect(s.evaluated).toBe(1);
    expect(s.results[0].overlap).toBe(2);
    expect(s.results[0].hits).toEqual(["rains", "dynasty"]);
    // ⚠️ The misses are the useful half — that is where the engine is wrong.
    expect(s.results[0].misses).toEqual(["ironhead", "barbarian", "cocoburry"]);
    expect(s.lift).toBeGreaterThan(1);
  });

  it("⛔ excludes picks made from a list we suggested", () => {
    // Our own output handed back is agreement with ourselves, not evidence.
    const s = scorePredictions([pick({ chosenFrom: "suggested" })], [predicted()], 80);
    expect(s.evaluated).toBe(0);
    expect(s.excludedContaminated).toBe(1);
  });

  it("⛔ refuses a prediction made AFTER the pick", () => {
    // Structural, not on trust: a run that started later cannot be a prediction.
    const s = scorePredictions(
      [pick({ pickedAt: new Date("2026-09-01") })],
      [predicted({ predictedAt: new Date("2026-09-15") })],
      80
    );
    expect(s.evaluated).toBe(0);
    expect(s.excludedNoPrediction).toBe(1);
  });

  it("takes the newest prediction that still predates the pick", () => {
    const s = scorePredictions(
      [pick()],
      [
        predicted({ predictedAt: new Date("2026-01-01"), predicted: ["wrong", "wrong2"] }),
        predicted({ predictedAt: new Date("2026-09-20") }),
        predicted({ predictedAt: new Date("2026-11-01"), predicted: ["rains", "dynasty", "ironhead", "barbarian", "cocoburry"] }),
      ],
      80
    );
    // Not the perfect November one — that was made after they picked.
    expect(s.results[0].overlap).toBe(2);
  });

  it("compares like with like — our top N against their N", () => {
    // Scoring a top-25 list against five picks would inflate overlap fivefold.
    const s = scorePredictions(
      [pick({ chosen: ["a", "b"] })],
      [predicted({ predicted: ["z", "y", "a", "b"] })],
      80
    );
    expect(s.results[0].predicted).toBe(2);
    expect(s.results[0].overlap).toBe(0);
  });

  it("reports zeros rather than dividing by nothing when there are no picks", () => {
    const s = scorePredictions([], [predicted()], 80);
    expect(s.evaluated).toBe(0);
    expect(s.meanOverlap).toBe(0);
    expect(s.lift).toBe(0);
  });

  it("a lift of 1 means the engine added nothing at all", () => {
    // Two subjects, one hit between them, chance 0.3125 — barely above noise.
    const s = scorePredictions(
      [pick({ subjectId: "a" }), pick({ subjectId: "b", chosen: ["x", "y", "z", "w", "v"] })],
      [predicted({ subjectId: "a", predicted: ["rains", "q", "r", "s", "t"] }),
       predicted({ subjectId: "b", predicted: ["m", "n", "o", "p", "q"] })],
      80
    );
    expect(s.meanOverlap).toBe(0.5);
    expect(s.lift).toBeGreaterThan(1);
  });
});
