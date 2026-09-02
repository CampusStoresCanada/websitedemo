import "server-only";

/**
 * Reading the engine's output.
 *
 * Every surface that used to score inline reads from here instead. The two
 * mirrored matchers — `lib/actions/member-suppliers.ts` and
 * `lib/actions/partner-market.ts` — were the same algorithm written twice in
 * opposite directions; this is how that stops being true without rewriting a
 * single component, because the shapes they return are preserved exactly.
 *
 * ── Absence is not an error ─────────────────────────────────────────────────
 *
 * `readMatchEdges` returns **null** when the engine has nothing to say: the
 * migration is not applied, no run has been promoted, or last night's job did
 * not finish. Null means "fall back to computing it live", never "no matches".
 * A surface that renders empty because a batch job failed is worse than one that
 * quietly does the old thing, and the difference has to be legible at the type
 * level or someone will treat the two as the same.
 *
 * ⛔ `reasons` carries EVERY reason, each with its own provenance — `sourceOrgId`
 * and `sourceVisibility`. This layer has no opinion about who may read what;
 * that is decided at surfaces, which know their reader. `reasonsVisibleTo()` in
 * edge-view.ts implements the common filter as a convenience, not a gate.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchDirection } from "./types";
import type { StoredEdge, StoredReason } from "./read-types";

export type { StoredEdge, StoredReason } from "./read-types";
export { confidenceBucket, categoryEvidence, hasCertificationMatch } from "./edge-view";

/** The run the site is currently reading. Null if none, or if the table is absent. */
export async function getPromotedRunId(): Promise<string | null> {
  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("match_runs")
      .select("id")
      .eq("status", "promoted")
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

export interface ReadEdgesOptions {
  subjectOrgId: string;
  direction: MatchDirection;
  limit?: number;
  /** Reuse a run id across several reads in one request rather than re-querying. */
  runId?: string | null;
  /**
   * Narrow to one person's edges.
   *
   * Omit for the org-level prior (the default, and all that exists today).
   * Passing a contact id asks the more specific question — "what was recommended
   * to Zach", not "to McMaster".
   */
  subjectContactId?: string | null;
}

/**
 * Ranked candidates for one subject, or null if the engine has nothing.
 *
 * ⛔ Does NOT filter declared refusals. A score may never be the reason two orgs
 * do not meet — the caller applies refusals from the declaration itself, before
 * and independently of anything stored here.
 */
export async function readMatchEdges(options: ReadEdgesOptions): Promise<StoredEdge[] | null> {
  const runId = options.runId !== undefined ? options.runId : await getPromotedRunId();
  if (!runId) return null;

  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("match_edges")
      .select(
        "candidate_org_id, subject_contact_id, candidate_contact_id, total, score, confidence, rank, breakdown, reasons"
      )
      .eq("run_id", runId)
      .eq("direction", options.direction)
      .eq("subject_org_id", options.subjectOrgId)
      // `.is(null)` rather than omitting the filter: without it an org-level read
      // would also return every person edge underneath it, silently multiplying
      // each candidate by however many buyers that org happens to name.
      [options.subjectContactId ? "eq" : "is"](
        "subject_contact_id",
        options.subjectContactId ?? null
      )
      .order("rank", { ascending: true })
      .limit(options.limit ?? 50);

    if (error) return null;
    // An empty array is a real answer — this subject genuinely matched nothing —
    // whereas null upstream meant the engine was unavailable. Preserve that.
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      candidateOrgId: r.candidate_org_id as string,
      subjectContactId: (r.subject_contact_id as string | null) ?? null,
      candidateContactId: (r.candidate_contact_id as string | null) ?? null,
      total: Number(r.total),
      score: Number(r.score),
      confidence: Number(r.confidence),
      rank: Number(r.rank),
      breakdown: (r.breakdown ?? {}) as Record<string, number | null>,
      reasons: (r.reasons ?? []) as StoredReason[],
    }));
  } catch {
    return null;
  }
}
