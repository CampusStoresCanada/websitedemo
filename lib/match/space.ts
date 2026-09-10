/**
 * One space. Everybody in it.
 *
 * ── Why this replaces the weighted axes ─────────────────────────────────────
 *
 * `score.ts` asks nine hand-named questions and multiplies each answer by a
 * weight a human typed. That is a credit score, and it failed the way credit
 * scores fail: 989 member↔partner edges collapsed onto 36 distinct values,
 * 39% of them identical, because seven of the nine questions are set-overlap
 * tests that can only answer a handful of ways.
 *
 * This module asks no questions. Every act a person takes — a post, a reply, a
 * search, a declared category, a job title — is turned into text, embedded by a
 * pretrained model, and pooled into one vector. A vendor is pooled the same way
 * from the same model. Nearness between two vectors IS the score.
 *
 * ⛔ Nobody names a dimension and nobody types a weight. If you find yourself
 * about to add `const CATEGORY_WEIGHT = 30` you have rebuilt the thing this
 * replaces. The only knobs here are how much a RECENT act counts over an old
 * one, and how much a STRONG act counts over a weak one — properties of the
 * act, not of what it was about.
 *
 * ⛔ Not two towers. Members and partners are not opposite sides of a market;
 * ~790 people interact in one heap and the member/partner label is a filter
 * applied when READING, never a structural divide. Member↔member matching falls
 * out of the same space for free, which is what the community already does on
 * its own every day.
 */

import { normalize, dot } from "@/lib/signals/embedding";
import { decayedWeight } from "@/lib/signals/decay";
import type { SignalVerb } from "@/lib/signals/types";

/** One embedded act. The vector is what was said; the rest is how much it counts. */
export interface SignalVector {
  /** The embedding of this act's text. Need not be normalized. */
  vector: readonly number[];
  /** What kind of act it was — sets the base weight and the half-life. */
  verb: SignalVerb;
  /** When it happened. Absent means undated: counted at full weight, never decayed. */
  occurredAt?: Date | null;
  /**
   * Overrides the verb's default strength when the producer knows more — a
   * one-line reply, a search that returned nothing.
   *
   * ⛔ NEGATIVE means "away from this", and it is a first-class case. A person
   * who was invited to a session about digital course materials and did not go
   * has told us something; so has one who said a vendor let them down. Without
   * repulsion the only expressible opinion is enthusiasm, and every act — however
   * sour — drags a person TOWARD what it was about.
   *
   * ⚠️ We do not know what any of it MEANS. Somebody opening a mail eight times
   * might be keen or might be confused, and nobody here is qualified to say
   * which. The act moves the vector; the interpretation is not ours to write
   * down. Producers set direction and strength, never meaning.
   */
  weight?: number;
  /** Kept for provenance. Never read by the arithmetic. */
  ref?: string;
}

export interface PoolOptions {
  /** Defaults to now. Passed explicitly so a run is reproducible. */
  now?: Date;
  /**
   * Acts below this weight after decay are dropped rather than summed.
   *
   * ⚠️ Not a tuning knob for relevance — it exists so a decade of stale glances
   * cannot outvote last week at three decimal places each.
   */
  floor?: number;
}

/**
 * Everything one entity has ever done, as a single direction.
 *
 * A weighted mean, then normalized: the result says WHERE this person sits, not
 * how loud they are. Someone who posts constantly should not out-rank someone
 * who posted once about exactly the right thing — volume belongs in
 * `confidence`, never in position.
 *
 * ⛔ Returns null rather than a zero vector when nothing survives. A zero vector
 * is equidistant from everything and would quietly match a silent person to the
 * entire roster.
 */
export function poolSignals(
  signals: readonly SignalVector[],
  options: PoolOptions = {}
): { vector: number[]; contributing: number; mass: number } | null {
  if (signals.length === 0) return null;
  const now = options.now ?? new Date();
  const floor = options.floor ?? 0.01;

  const dims = signals[0].vector.length;
  const sum = new Array<number>(dims).fill(0);
  let mass = 0;
  let contributing = 0;

  for (const s of signals) {
    if (s.vector.length !== dims) continue; // a different model's output; never mix
    // ⛔ Decay the MAGNITUDE and re-apply the sign. `decayedWeight` multiplies by
    // a positive factor, so handing it a negative returns a negative that grows
    // toward zero correctly — but the floor test must compare magnitudes, or
    // every repulsion is silently dropped for being "below" a positive floor.
    const base = s.weight;
    const w = s.occurredAt
      ? decayedWeight(s.verb, s.occurredAt, now, base === undefined ? undefined : Math.abs(base))
        * (base !== undefined && base < 0 ? -1 : 1)
      : (base ?? 1);
    if (!(Math.abs(w) > floor)) continue;
    const unit = normalize(s.vector);
    for (let i = 0; i < dims; i++) sum[i] += unit[i] * w;
    // Magnitude, so a negative act still counts as EVIDENCE. Someone we know a
    // lot of unenthusiastic things about is well observed, not poorly observed.
    mass += Math.abs(w);
    contributing++;
  }

  if (contributing === 0 || mass === 0) return null;
  // ⚠️ Signals that cancel out leave no direction at all — someone pulled equally
  // toward and away from the same thing. That is a genuine "we cannot place
  // them", not an origin point that would sit equidistant from everybody.
  const len = Math.sqrt(sum.reduce((a, x) => a + x * x, 0));
  if (len < 1e-9) return null;
  return { vector: normalize(sum), contributing, mass };
}

/** Cosine similarity. Both must already be normalized — `poolSignals` returns them so. */
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  return dot(a, b);
}

/**
 * Turn similarities into 0..100 by their position in THIS run's distribution.
 *
 * ⛔ Deliberately not a fixed band. An earlier version hard-coded 0.3→0.9, which
 * was fitted by eye to uncentred cosine; the moment `removeCommonDirection` moved
 * the distribution to roughly −0.17..0.39, that band clamped 98% of pairs to
 * zero and left 68 distinct scores out of 6,000. A constant chosen by looking at
 * one run is a weight typed by a human wearing a different hat.
 *
 * Calibrating on the run's own spread means the scale follows the data whatever
 * the model, the corpus or the centring does to it.
 *
 * ⚠️ Monotone by construction, so it can never reorder anything — but RANK ON
 * `similarity`, never on this. A percentile says how a pair compares to other
 * pairs, not how good it is: in a run where nobody matches anybody, the least
 * bad pair still scores 100.
 */
export function calibrate(
  similarities: readonly number[]
): (cos: number) => number {
  const sorted = [...similarities].sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (hi - lo < 1e-9) return () => 50;

  return (cos: number) => {
    // Binary search for how many observations this beats.
    let a = 0, b = sorted.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (sorted[mid] < cos) a = mid + 1;
      else b = mid;
    }
    return (a / sorted.length) * 100;
  };
}

/**
 * How much one shared signal is worth.
 *
 * ⚠️ Attendance broke this the first time it was wired in. Everyone who came to
 * the same webinar got the same document, so the whole cohort drifted toward
 * that event's topic and ONE partner took the #1 slot for 51 of 284 people. An
 * event the entire association was invited to says what CSC programmed, not what
 * any individual buys — the same failure as counting the association's own
 * announcements as a member's voice.
 *
 * Inverse document frequency: a thing five people did separates those five; a
 * thing two hundred people did separates nobody. Computed from the data, so it
 * is not a weight anyone typed — an event that becomes popular loses influence
 * on its own, with no config change.
 *
 * ⛔ Never returns 0. A universally-shared act is uninformative, not evidence of
 * absence, and zeroing it would silently delete a real thing that happened.
 */
export function rarityWeight(sharedBy: number, population: number): number {
  if (sharedBy <= 0 || population <= 0) return 1;
  const share = Math.min(sharedBy, population) / population;
  // log1p keeps a solitary act from dominating the way raw 1/share would.
  return Math.log1p(1 / share) / Math.log1p(population);
}

/**
 * The single act that best matches a target, not the average of all of them.
 *
 * ── Why an average is not enough ────────────────────────────────────────────
 *
 * A person's pooled position is a fair summary and a poor witness. Waterloo's
 * buyers post about Roots, Hollister and trendy hoodies — and about staplers,
 * and chocolates, and tote bags. Averaged, that centre sits somewhere between
 * apparel and office supplies and is a strong statement about neither.
 *
 * Measured on the real pair: Waterloo's individual acts reach **0.6** against
 * RAINS, while the pooled position reaches **0.27**. The evidence was there all
 * along; pooling diluted it with staplers.
 *
 * So the two answer different questions and both are worth having:
 *   pooled    where does this person sit overall
 *   best act  is there a specific thing they said that matches THIS candidate
 *
 * ⛔ The act is also the REASON. "Waterloo → RAINS" is a number; "because Ana
 * said their Roots sales fell 25% and they are still with them" is something a
 * human can act on. Returning the index means the sentence survives the scoring.
 *
 * ⚠️ Vectors must be centred the same way as everything else, or this measures
 * genericness: uncentred, every act in this corpus scores ~0.6 against every
 * partner because it is all campus-store text.
 */
export function bestMatchingAct(
  acts: readonly (readonly number[])[],
  target: readonly number[]
): { index: number; similarity: number } | null {
  if (acts.length === 0 || target.length === 0) return null;
  let index = -1;
  let best = -Infinity;
  for (let i = 0; i < acts.length; i++) {
    if (acts[i].length !== target.length) continue;
    const sim = dot(acts[i], target);
    if (sim > best) { best = sim; index = i; }
  }
  return index < 0 ? null : { index, similarity: best };
}

/**
 * Project the shared direction out of raw act vectors.
 *
 * The same operation as `removeCommonDirection`, applied one level down. Doing
 * it here rather than after pooling means acts and positions live in the SAME
 * centred space, so a best-act similarity and a pooled similarity are directly
 * comparable — and pooling centred acts gives the same position as centring the
 * pooled result, because projection is linear.
 */
export function centreVectors(vectors: readonly (readonly number[])[]): number[][] {
  if (vectors.length < 3) return vectors.map((v) => [...v]);
  const dims = vectors[0].length;
  const mean = new Array<number>(dims).fill(0);
  for (const v of vectors) {
    if (v.length !== dims) continue;
    for (let i = 0; i < dims; i++) mean[i] += v[i];
  }
  const axis = normalize(mean);
  return vectors.map((v) => {
    if (v.length !== dims) return [...v];
    const along = dot(v, axis);
    const rest = v.map((x, i) => x - along * axis[i]);
    const norm = Math.sqrt(rest.reduce((s, x) => s + x * x, 0));
    return norm < 1e-9 ? [...v] : normalize(rest);
  });
}

export interface Placed {
  id: string;
  vector: number[];
  /** How much evidence stands behind this position. */
  contributing: number;
  mass: number;
}

/**
 * Remove the direction everything shares.
 *
 * ⚠️ Without this the space reports GENERICNESS as fit. Every document here is
 * campus-store text, so they all point partly the same way; raw cosine came back
 * bunched between 0.38 and 0.79 with nothing near zero, and one partner took the
 * #1 slot for 65 of 240 people purely by sitting closest to the average of
 * everything. A vector near everything means nothing.
 *
 * Projecting out the mean direction leaves only what makes each entity
 * DIFFERENT, which is the only part that can carry a match. This is the
 * "all-but-the-top" trick and it is standard for exactly this failure.
 *
 * ⛔ Still no hand-written weights: the direction removed is computed from the
 * data, not chosen. Centre over the WHOLE population — centring each side
 * separately would erase the member/partner distinction along with the
 * genericness.
 */
export function removeCommonDirection(all: readonly Placed[]): Placed[] {
  if (all.length < 3) return [...all];
  const dims = all[0].vector.length;

  const mean = new Array<number>(dims).fill(0);
  for (const p of all) {
    if (p.vector.length !== dims) continue;
    for (let i = 0; i < dims; i++) mean[i] += p.vector[i];
  }
  const axis = normalize(mean);

  return all.map((p) => {
    if (p.vector.length !== dims) return p;
    const along = dot(p.vector, axis);
    const rest = p.vector.map((v, i) => v - along * axis[i]);
    // An entity sitting exactly on the common direction has nothing left that
    // distinguishes it. Keep its original position rather than emitting noise.
    const norm = Math.sqrt(rest.reduce((s, v) => s + v * v, 0));
    return norm < 1e-9 ? p : { ...p, vector: normalize(rest) };
  });
}

export interface Neighbour {
  id: string;
  similarity: number;
}

/**
 * The nearest candidates to one subject.
 *
 * ⛔ Takes no blocklist and no refusal set. A score may never be the reason two
 * people do not meet — refusals are a human fact applied by the caller, before
 * and independently of anything computed here.
 */
export function nearest(
  subject: Placed,
  candidates: readonly Placed[],
  options: { k?: number; minSimilarity?: number } = {}
): Neighbour[] {
  const k = options.k ?? 50;
  const min = options.minSimilarity ?? -1;
  const out: Neighbour[] = [];

  for (const c of candidates) {
    if (c.id === subject.id) continue;
    const cos = similarity(subject.vector, c.vector);
    if (cos < min) continue;
    out.push({ id: c.id, similarity: cos });
  }

  // Ties are real and common; break them on id so a run is reproducible rather
  // than ordered by whatever the scan happened to produce.
  out.sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : 1));
  return out.slice(0, k);
}

/**
 * How much we actually know about an entity's position, 0..1.
 *
 * ⛔ Separate from similarity on purpose. A person with one post can sit very
 * near a vendor by luck; a person with two hundred acts sits where they sit.
 * Consumers decide what to do with a confident-but-distant versus an
 * uncertain-but-near pairing — this layer must not fold one into the other,
 * which is exactly the mistake `ranking` made in the axis engine.
 *
 * Saturating rather than linear: the difference between 1 and 10 acts is large,
 * between 100 and 200 is not.
 */
export function placementConfidence(p: Placed, halfAt = 8): number {
  return p.mass / (p.mass + halfAt);
}
