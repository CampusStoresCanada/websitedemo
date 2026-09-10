/**
 * The nightly run, as a pure function.
 *
 * Everything that decides anything lives here: profiles in, edges out, no I/O.
 * `scripts/match-run.mts` is the shell that fetches and writes — it holds no
 * logic, so the part worth trusting can be tested without a database, and the
 * part that touches the database is small enough to read in one sitting.
 *
 * ⛔ Nothing here enforces a relationship. Declared refusals are applied by
 * consumers, from the declaration, before and independently of any score. This
 * produces affinity; it never produces permission.
 */

import { buildMatchProfile, type MatchProfileInput } from "./profile";
import { rankCandidates, matchTotal } from "./score";
import { DEFAULT_MATCH_WEIGHTS } from "./weights";
import { bestPerTerm, normalizeTermWeights, termKey } from "@/lib/signals/aggregate";
import type { AffinityRollup, TermRollup } from "@/lib/signals/types";
import type {
  MatchDirection,
  MatchProfile,
  MatchWeights,
  RevealedAffinity,
  RevealedTerm,
} from "./types";

/** Subject and candidate pools for each direction. */
const DIRECTIONS: { direction: MatchDirection; subject: "member" | "partner"; candidate: "member" | "partner" }[] = [
  { direction: "member_to_partner", subject: "member", candidate: "partner" },
  { direction: "partner_to_member", subject: "partner", candidate: "member" },
  { direction: "member_to_member", subject: "member", candidate: "member" },
  { direction: "partner_to_partner", subject: "partner", candidate: "partner" },
];

export interface MatchEdgeRow {
  direction: MatchDirection;
  subjectOrgId: string;
  candidateOrgId: string;
  /**
   * The specific people, when the match resolves to them.
   *
   * Null on both is the ORG-LEVEL PRIOR — the institutional claim that person
   * edges sit underneath. Populated is the specific pairing. Same table, same
   * shape, different resolution; the runner writes only the prior today.
   */
  subjectContactId: string | null;
  candidateContactId: string | null;
  /** `ranking` — fit discounted by coverage. NEVER the raw score. */
  total: number;
  score: number;
  confidence: number;
  rank: number;
  breakdown: Record<string, number | null>;
  /** Every reason, each carrying its own provenance. Consumers filter. */
  reasons: unknown[];
}

export interface RunSummary {
  profiles: { member: number; partner: number; skipped: number };
  perDirection: {
    direction: MatchDirection;
    subjects: number;
    candidates: number;
    edgesKept: number;
    /** ⚠️ Reported, never silent. A cap that is not logged reads as full coverage. */
    edgesDroppedByCap: number;
    /**
     * The best `total` among the edges the cap discarded.
     *
     * The count alone is uninformative — dropping 2,370 pairs is harmless if the
     * best of them scored nothing, and alarming if it scored 40. This is the
     * number that says which, and therefore whether the cap needs raising.
     */
    bestDroppedTotal: number | null;
    /** Scored, but had nothing to say. Counted so the silence is visible. */
    edgesDroppedAsScoreless: number;
    subjectsWithNoEdge: number;
    /** Distribution of what was kept. A run where everything scores the same is a run that decided nothing. */
    medianTotal: number | null;
    maxTotal: number | null;
  }[];
  revealed: { orgsWithTerms: number; orgsWithAffinity: number };
  topPerSubject: number;
}

export interface RunResult {
  edges: MatchEdgeRow[];
  summary: RunSummary;
}

export interface RunInput {
  organizations: MatchProfileInput[];
  termRollups?: TermRollup[];
  affinityRollups?: AffinityRollup[];
  weights?: MatchWeights;
  now?: Date;
  /**
   * Edges stored per subject per direction.
   *
   * All pairs would be ~42k rows, and the tail is score-zero noise nothing will
   * ever read. Fifty is well past what any surface shows and leaves room for a
   * consumer to filter further. The count dropped is reported, never swallowed.
   */
  topPerSubject?: number;
  /**
   * Edges scoring at or below this are not stored at all.
   *
   * ⛔ Zero is not a weak match, it is the absence of one — and a stored zero
   * reads like an answer. Measured on live data, the median member_to_partner
   * edge scored 0.0, so half of everything written would have been the engine
   * recording that it had nothing to say. Dropping them shrinks the table and
   * makes "no rows" mean what it should.
   */
  minTotal?: number;
  includeTestOrgs?: boolean;
}

/**
 * Rolled-up terms → per-org revealed evidence.
 *
 * ⚠️ Weights are normalised against each org's OWN strongest term. Absolute
 * weights are not comparable between orgs — a fifteen-person store out-browses a
 * two-person shop at everything, and ranking on raw totals would rank by
 * headcount rather than by interest.
 */
export function revealedTermsByOrg(rollups: readonly TermRollup[]): Map<string, RevealedTerm[]> {
  const collapsed = bestPerTerm(rollups);
  const normalized = normalizeTermWeights(collapsed);
  const byOrg = new Map<string, RevealedTerm[]>();

  for (const row of collapsed) {
    // Negative term signal is not an interest and must not present as one.
    if (row.polarity !== "positive") continue;
    const list = byOrg.get(row.organizationId) ?? [];
    list.push({
      term: row.term,
      weight: normalized.get(termKey(row.organizationId, row.term)) ?? 0,
      source: row.termSource,
      actorCount: row.actorCount,
    });
    byOrg.set(row.organizationId, list);
  }

  for (const list of byOrg.values()) list.sort((a, b) => b.weight - a.weight);
  return byOrg;
}

/**
 * Rolled-up affinity → per-org edges.
 *
 * ⚠️ Normalised against the org's strongest POSITIVE affinity only. A refusal is
 * the heaviest thing in the system, so letting one set the ceiling would crush
 * every genuine interest toward zero.
 */
export function revealedAffinityByOrg(
  rollups: readonly AffinityRollup[]
): Map<string, RevealedAffinity[]> {
  const maxByOrg = new Map<string, number>();
  for (const row of rollups) {
    if (row.polarity !== "positive") continue;
    maxByOrg.set(row.organizationId, Math.max(maxByOrg.get(row.organizationId) ?? 0, row.weight));
  }

  const byOrg = new Map<string, RevealedAffinity[]>();
  for (const row of rollups) {
    const max = maxByOrg.get(row.organizationId) ?? 0;
    const list = byOrg.get(row.organizationId) ?? [];
    list.push({
      orgId: row.objectOrgId,
      // A negative edge carries full strength: it is a declaration, not a
      // quantity to be scaled against browsing.
      weight: row.polarity === "negative" ? 1 : max > 0 ? row.weight / max : 0,
      stance: row.stance,
      polarity: row.polarity,
      actorCount: row.actorCount,
    });
    byOrg.set(row.organizationId, list);
  }
  return byOrg;
}

export function runMatch(input: RunInput): RunResult {
  const now = input.now ?? new Date();
  const weights = input.weights ?? DEFAULT_MATCH_WEIGHTS;
  const topPerSubject = input.topPerSubject ?? 50;
  const minTotal = input.minTotal ?? 0;

  const terms = revealedTermsByOrg(input.termRollups ?? []);
  const affinities = revealedAffinityByOrg(input.affinityRollups ?? []);

  // ── Profiles ─────────────────────────────────────────────────────────────
  // buildMatchProfile refuses archived orgs, test orgs and unknown types, so an
  // org that must never be recommended cannot reach a candidate pool at all.
  const profiles: MatchProfile[] = [];
  let skipped = 0;
  for (const row of input.organizations) {
    const profile = buildMatchProfile(row, {
      includeTestOrgs: input.includeTestOrgs,
      revealedTerms: terms.get(row.id) ?? [],
      revealedAffinities: affinities.get(row.id) ?? [],
    });
    if (profile) profiles.push(profile);
    else skipped++;
  }

  const members = profiles.filter((p) => p.type === "member");
  const partners = profiles.filter((p) => p.type === "partner");
  const pool = { member: members, partner: partners };

  // ── Score ────────────────────────────────────────────────────────────────
  const edges: MatchEdgeRow[] = [];
  const perDirection: RunSummary["perDirection"] = [];

  for (const { direction, subject, candidate } of DIRECTIONS) {
    const subjects = pool[subject];
    const candidates = pool[candidate];
    let kept = 0;
    let dropped = 0;
    let empty = 0;
    let bestDropped: number | null = null;
    let scoreless = 0;
    const totals: number[] = [];

    for (const subjectProfile of subjects) {
      const ranked = rankCandidates(subjectProfile, candidates, direction, { weights, now });
      if (ranked.length === 0) {
        empty++;
        continue;
      }

      // ⚠️ Scoreless first, THEN the cap. The other order made both numbers lie:
      // "2,370 beyond top-50" counted mostly zeros, so the cap looked far more
      // aggressive than it was, and `bestDropped` was measured against a list
      // still padded with nothing. Filtering first means "dropped by cap" reads
      // as "dropped despite being worth storing", which is the only version of
      // that number anyone should act on.
      const worthStoring = ranked.filter((pair) => matchTotal(pair) > minTotal);
      scoreless += ranked.length - worthStoring.length;

      if (worthStoring.length > topPerSubject) {
        dropped += worthStoring.length - topPerSubject;
        const best = matchTotal(worthStoring[topPerSubject]);
        if (bestDropped === null || best > bestDropped) bestDropped = best;
      }

      for (const pair of worthStoring.slice(0, topPerSubject)) {

        edges.push({
          direction,
          subjectOrgId: pair.subjectId,
          candidateOrgId: pair.candidateId,
          // Org-level prior. Person edges are scored on top of these, not
          // instead of them — an org pair that scored nothing has no people
          // worth ranking either.
          subjectContactId: null,
          candidateContactId: null,
          total: matchTotal(pair),
          score: pair.score,
          confidence: pair.confidence,
          rank: pair.rank,
          breakdown: pair.breakdown,
          // ⛔ ONE array. Splitting citable from withheld at write time baked one
          // audience model into permanent data; provenance on each reason lets
          // every surface answer that question for itself.
          reasons: pair.reasons,
        });
        totals.push(matchTotal(pair));
        kept++;
      }
    }

    totals.sort((a, b) => a - b);

    perDirection.push({
      direction,
      subjects: subjects.length,
      candidates: candidates.length,
      edgesKept: kept,
      edgesDroppedByCap: dropped,
      bestDroppedTotal: bestDropped,
      edgesDroppedAsScoreless: scoreless,
      subjectsWithNoEdge: empty,
      medianTotal: totals.length ? totals[Math.floor(totals.length / 2)] : null,
      maxTotal: totals.length ? totals[totals.length - 1] : null,
    });
  }

  return {
    edges,
    summary: {
      profiles: { member: members.length, partner: partners.length, skipped },
      perDirection,
      revealed: { orgsWithTerms: terms.size, orgsWithAffinity: affinities.size },
      topPerSubject,
    },
  };
}

/** One-line-per-direction report, for the job's own output. */
export function describeRun(summary: RunSummary): string {
  const lines = [
    `profiles: ${summary.profiles.member} members · ${summary.profiles.partner} partners · ${summary.profiles.skipped} skipped (archived/test/other type)`,
    `revealed: ${summary.revealed.orgsWithTerms} orgs with terms · ${summary.revealed.orgsWithAffinity} with affinity`,
  ];
  for (const d of summary.perDirection) {
    const n = (v: number | null) => (v === null ? "—" : v.toFixed(1));
    // Report the best dropped edge, not just how many: a cap that discards
    // nothing of value is fine, and only this number says which case it is.
    const dropped =
      d.edgesDroppedByCap > 0
        ? ` · ${d.edgesDroppedByCap} beyond top-${summary.topPerSubject} not stored (best ${n(d.bestDroppedTotal)})`
        : "";
    const scoreless = d.edgesDroppedAsScoreless > 0 ? ` · ${d.edgesDroppedAsScoreless} scoreless` : "";
    const empty = d.subjectsWithNoEdge > 0 ? ` · ⚠️ ${d.subjectsWithNoEdge} subjects with no candidate` : "";
    lines.push(
      `${d.direction.padEnd(19)} ${String(d.edgesKept).padStart(6)} edges  median ${n(d.medianTotal).padStart(5)}  max ${n(d.maxTotal).padStart(5)}${scoreless}${dropped}${empty}`
    );
  }
  return lines.join("\n");
}
