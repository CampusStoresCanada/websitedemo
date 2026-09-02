/**
 * Did we predict who a person actually wants to meet?
 *
 * ── The first honest test of this engine ────────────────────────────────────
 *
 * Every offline check built from declared fields is circular: the old nine-axis
 * scorer joins on category, so testing it against categories scores 100% and
 * proves nothing. A Top 5 pick is different — it is a person naming five orgs,
 * unprompted, from an alphabetical list of everyone present. Nothing in it comes
 * from us. Steve: "If our top 5 for anyone are nowhere near their top 5 then we
 * know that things are hinky."
 *
 * ⛔ ONLY COLD PICKS COUNT. A pick made from a list we suggested is our own
 * output handed back, and scoring against it measures agreement with ourselves.
 * `conference_top_choices.chosen_from` separates them; anything 'suggested' is
 * excluded here and must stay excluded however tempting the sample size gets.
 *
 * ⛔ THE PREDICTION MUST PREDATE THE PICK, and structurally rather than on
 * trust. A run is immutable and timestamped, so the prediction of record is the
 * newest run that STARTED BEFORE that person picked. Nobody can fit a prediction
 * to a known answer, including by accident.
 *
 * ⚠️ Being IN the five is the signal. `picked_order` is click order on an
 * alphabetical list — rank 1 largely means "name begins with A" — so this
 * measures set overlap and never ordering.
 */

/** One person's (or org's) five, as they picked them. */
export interface PickSet {
  subjectId: string;
  /** Ids of the orgs they chose. */
  chosen: readonly string[];
  /** When they picked, so a prediction can be shown to predate it. */
  pickedAt: Date;
  /** Where the pick came from. Anything but a cold source is excluded. */
  chosenFrom: "suggested" | "search" | "browse" | null;
}

/** What we said, before they said it. */
export interface Prediction {
  subjectId: string;
  /** Our top N candidate org ids, best first. */
  predicted: readonly string[];
  /** When the run that produced this started. */
  predictedAt: Date;
}

export interface OverlapResult {
  subjectId: string;
  overlap: number;
  picked: number;
  predicted: number;
  /** The ones we got right — worth reading, not just counting. */
  hits: string[];
  /** Picked, and nowhere in our list. These are where the engine is wrong. */
  misses: string[];
}

export interface TestSummary {
  /** Subjects with a usable cold pick AND a prediction that predates it. */
  evaluated: number;
  /** Excluded because the pick came off a list we suggested. */
  excludedContaminated: number;
  /** Excluded because no run predates the pick — we had said nothing yet. */
  excludedNoPrediction: number;
  meanOverlap: number;
  /** Overlap expected from picking at random, given the pool. */
  chanceOverlap: number;
  /** How many times better than chance. 1.0 means the engine adds nothing. */
  lift: number;
  results: OverlapResult[];
}

/**
 * Expected overlap between two independent sets of size a and b drawn from a
 * pool of n. This is the number the result has to beat to mean anything.
 */
export function chanceOverlap(a: number, b: number, pool: number): number {
  if (pool <= 0) return 0;
  return (a * b) / pool;
}

/**
 * Score predictions against cold picks.
 *
 * ⚠️ `pool` is the number of orgs that were OFFERABLE — present at the
 * conference, on the other side of the market. Not the whole roster. Using the
 * roster would understate chance and flatter the engine.
 */
export function scorePredictions(
  picks: readonly PickSet[],
  predictions: readonly Prediction[],
  pool: number
): TestSummary {
  const bySubject = new Map<string, Prediction[]>();
  for (const p of predictions) {
    bySubject.set(p.subjectId, [...(bySubject.get(p.subjectId) ?? []), p]);
  }

  const results: OverlapResult[] = [];
  let contaminated = 0;
  let noPrediction = 0;

  for (const pick of picks) {
    if (pick.chosen.length === 0) continue;
    if (pick.chosenFrom === "suggested") { contaminated++; continue; }

    // The newest prediction made BEFORE they picked. Never one made after.
    const candidates = (bySubject.get(pick.subjectId) ?? [])
      .filter((p) => p.predictedAt.getTime() < pick.pickedAt.getTime())
      .sort((a, b) => b.predictedAt.getTime() - a.predictedAt.getTime());
    const prediction = candidates[0];
    if (!prediction) { noPrediction++; continue; }

    // ⚠️ Compare like with like: our top N where N is how many they picked.
    // Scoring our top 25 against their five would inflate overlap fivefold.
    const top = prediction.predicted.slice(0, pick.chosen.length);
    const predictedSet = new Set(top);
    const hits = pick.chosen.filter((c) => predictedSet.has(c));
    const misses = pick.chosen.filter((c) => !predictedSet.has(c));

    results.push({
      subjectId: pick.subjectId,
      overlap: hits.length,
      picked: pick.chosen.length,
      predicted: top.length,
      hits,
      misses,
    });
  }

  const meanOverlap = results.length
    ? results.reduce((s, r) => s + r.overlap, 0) / results.length
    : 0;
  const meanPicked = results.length
    ? results.reduce((s, r) => s + r.picked, 0) / results.length
    : 0;
  const chance = chanceOverlap(meanPicked, meanPicked, pool);

  return {
    evaluated: results.length,
    excludedContaminated: contaminated,
    excludedNoPrediction: noPrediction,
    meanOverlap,
    chanceOverlap: chance,
    // ⛔ Lift, not raw overlap. "We got 1.4 of 5" means nothing without knowing
    // that chance is 0.31 — and a category-level test earlier tonight looked
    // like 76% accuracy when chance was 75.8%.
    lift: chance > 0 ? meanOverlap / chance : 0,
    results,
  };
}
