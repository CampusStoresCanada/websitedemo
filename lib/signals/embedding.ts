/**
 * Clustering the community's own words.
 *
 * Pure — vectors in, clusters out, no network. The embedding itself happens in
 * `scripts/circle-embed.mts` against a local ollama, so this half can be tested
 * without a model.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Four rounds of hand-written keyword rules failed the same way: each fixed the
 * layer it could see and left the next. The final version still resolved
 * "Apple Accessories Students Can Afford" to the drinkware-and-lanyards
 * department, because "Accessories" genuinely IS a department name — a homonym
 * no word list can reach.
 *
 * The point of clustering is that nobody writes the rules. Posts about phone
 * cases land near posts about chargers because of how they are written, not
 * because someone anticipated the vocabulary. And the clusters that map to NO
 * taxonomy term are the evidence for categories that ought to exist —
 * "nursing watches", "jellycats", "pajama pants" have no NACS home and are not
 * going to get one by force.
 */

/** Unit-length copy, so a dot product IS cosine similarity. */
export function normalize(vector: readonly number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return [...vector];
  return vector.map((v) => v / norm);
}

/** Cosine similarity of two vectors that are ALREADY normalized. */
export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface Clustered {
  /** Index into the input array. */
  members: number[];
  /** The member nearest the cluster's centre — the item to show a human. */
  medoid: number;
  /** Mean similarity of members to the centroid. Low = an incoherent cluster. */
  cohesion: number;
}

/**
 * Spherical k-means.
 *
 * Vectors are normalized, so assignment by maximum dot product is assignment by
 * cosine — the right metric for text embeddings, where direction carries the
 * meaning and magnitude mostly carries length.
 *
 * ⚠️ Seeded deterministically (k-means++ over a fixed order) rather than
 * randomly. A clustering a human is about to spend half an hour labelling must
 * come back the same on the next run, or the labels describe a world that no
 * longer exists.
 */
export function kmeans(
  vectors: readonly (readonly number[])[],
  k: number,
  options: { iterations?: number } = {}
): Clustered[] {
  const n = vectors.length;
  if (n === 0 || k <= 0) return [];
  const dims = vectors[0].length;
  const clusterCount = Math.min(k, n);
  const iterations = options.iterations ?? 40;

  // ── Seeding: k-means++ without randomness ────────────────────────────────
  // First centre is item 0; each subsequent centre is the item FURTHEST from
  // everything chosen so far. Deterministic, and it spreads the seeds instead of
  // starting them on top of each other.
  const centroids: number[][] = [[...vectors[0]]];
  while (centroids.length < clusterCount) {
    let worstIndex = 0;
    let worstSimilarity = Infinity;
    for (let i = 0; i < n; i++) {
      let best = -Infinity;
      for (const c of centroids) best = Math.max(best, dot(vectors[i], c));
      if (best < worstSimilarity) {
        worstSimilarity = best;
        worstIndex = i;
      }
    }
    centroids.push([...vectors[worstIndex]]);
  }

  let assignment = new Array<number>(n).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;

    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(vectors[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignment[i] !== best) moved = true;
      assignment[i] = best;
    }

    const sums = centroids.map(() => new Array<number>(dims).fill(0));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignment[i];
      counts[c]++;
      const v = vectors[i];
      for (let d = 0; d < dims; d++) sums[c][d] += v[d];
    }
    for (let c = 0; c < centroids.length; c++) {
      // An emptied cluster keeps its previous centre rather than collapsing to
      // the origin, where it would attract everything on the next pass.
      if (counts[c] === 0) continue;
      centroids[c] = normalize(sums[c]);
    }

    if (!moved) break;
  }

  return centroids
    .map((centroid, c) => {
      const members = assignment.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
      if (members.length === 0) return null;
      let medoid = members[0];
      let bestSim = -Infinity;
      let total = 0;
      for (const i of members) {
        const sim = dot(vectors[i], centroid);
        total += sim;
        if (sim > bestSim) {
          bestSim = sim;
          medoid = i;
        }
      }
      return { members, medoid, cohesion: total / members.length };
    })
    .filter((c): c is Clustered => c !== null)
    .sort((a, b) => b.members.length - a.members.length);
}

/**
 * The items to put in front of a human for one cluster.
 *
 * The medoid plus the next most central members — showing the edge cases first
 * would make every cluster look incoherent, and showing random members wastes
 * the reviewer's attention on whatever happened to be nearby.
 */
export function representatives(
  cluster: Clustered,
  vectors: readonly (readonly number[])[],
  centroidOf: readonly number[],
  count = 6
): number[] {
  return [...cluster.members]
    .sort((a, b) => dot(vectors[b], centroidOf) - dot(vectors[a], centroidOf))
    .slice(0, count);
}

/** Mean of a set of vectors, normalized. The cluster's own centre. */
export function centroid(
  vectors: readonly (readonly number[])[],
  members: readonly number[]
): number[] {
  if (members.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const i of members) {
    for (let d = 0; d < dims; d++) sum[d] += vectors[i][d];
  }
  return normalize(sum);
}
