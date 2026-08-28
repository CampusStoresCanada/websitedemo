import { traceLeak, shiftFor, MIN_MARKABLE_VALUE, type LeakObservation } from "./canary";
import { METRICS, effectiveFte, type BenchmarkingRow } from "./comparison";

/**
 * Reading the trap.
 *
 * markValue has been stamping every peer figure with a per-recipient
 * fingerprint since the comparison went live, and traceLeak has been able to
 * read them back the whole time — but nothing invoked it, so the marks were
 * being applied into a void. Setting a trap nobody can read is worse than
 * setting none, because the notice on the report promises a capability that
 * does not exist.
 *
 * THIS PRODUCES EVIDENCE, NOT A VERDICT. Every candidate comes back ranked
 * with the arithmetic attached, and a tie stays a tie. The output is for a
 * conversation with a member, and the person having that conversation needs to
 * see why — a bare name invites acting on a coincidence.
 */

export interface TraceInput {
  organizationId: string;
  fieldKey: string;
  observedValue: number;
}

export interface TraceCandidate {
  organizationId: string;
  organizationName: string;
  matched: number;
  markable: number;
  /** Did we log this org opening the report? Absence is itself evidence. */
  viewedReport: boolean;
  /** Was this org sent the survey invitation for the year? */
  wasRecipient: boolean;
  verdict: "explains-all" | "partial" | "excluded" | "no-evidence";
}

export interface ResolvedObservation extends TraceInput {
  organizationName: string;
  trueValue: number | null;
  /** False when the figure is too small to carry a mark — it proves nothing. */
  markable: boolean;
  note: string | null;
}

export interface TraceReport {
  fiscalYear: number;
  observations: ResolvedObservation[];
  candidates: TraceCandidate[];
  /** Candidates whose fingerprint explains every markable observation. */
  survivors: TraceCandidate[];
  markableCount: number;
  summary: string;
}

/** The true value a report would have shown for this store and measure. */
export function trueValueFor(
  row: BenchmarkingRow | undefined,
  fieldKey: string,
  orgFte: unknown,
): number | null {
  if (!row) return null;
  const def = METRICS.find((m) => m.key === fieldKey);
  if (!def) return null;
  return def.compute(row, { fte: effectiveFte(orgFte, row.enrollment_fte) });
}

/**
 * Rank the candidates.
 *
 * Pure, so the reasoning can be tested without a database — the part that
 * matters here is what the verdicts mean, and that must not depend on a query.
 */
export function buildTraceReport(input: {
  fiscalYear: number;
  observations: ResolvedObservation[];
  candidates: { organizationId: string; organizationName: string; viewedReport: boolean; wasRecipient: boolean }[];
}): TraceReport {
  const { fiscalYear, observations, candidates } = input;

  const usable: LeakObservation[] = observations
    .filter((o) => o.markable && o.trueValue !== null)
    .map((o) => ({
      targetOrgId: o.organizationId,
      fieldKey: o.fieldKey,
      observedValue: o.observedValue,
      trueValue: o.trueValue as number,
    }));

  const ranked = traceLeak(usable, candidates.map((c) => c.organizationId));
  const byId = new Map(candidates.map((c) => [c.organizationId, c]));

  const out: TraceCandidate[] = ranked.map((r) => {
    const meta = byId.get(r.recipientOrgId)!;
    // markable === 0 means every figure we were given carries no fingerprint
    // FOR THIS CANDIDATE — most often because the figures are their own, which
    // a store always sees unaltered. Silence is not agreement.
    const verdict: TraceCandidate["verdict"] =
      r.markable === 0
        ? "no-evidence"
        : r.matched === r.markable
          ? "explains-all"
          : r.matched === 0
            ? "excluded"
            : "partial";
    return {
      organizationId: r.recipientOrgId,
      organizationName: meta.organizationName,
      matched: r.matched,
      markable: r.markable,
      viewedReport: meta.viewedReport,
      wasRecipient: meta.wasRecipient,
      verdict,
    };
  });

  const survivors = out.filter((c) => c.verdict === "explains-all");

  let summary: string;
  if (usable.length === 0) {
    summary =
      "Nothing here carries a mark, so this cannot narrow the field. Marks only " +
      `attach to figures of $${MIN_MARKABLE_VALUE.toLocaleString("en-CA")} or more, and a store's own ` +
      "figures are never marked. Add a large revenue figure belonging to another store.";
  } else if (survivors.length === 0) {
    summary =
      "No recipient's fingerprint explains these figures. Either they were not " +
      "taken from a member's comparison page, or at least one was transcribed " +
      "wrongly — a single wrong digit excludes everyone.";
  } else if (survivors.length === 1) {
    summary =
      `One recipient explains all ${usable.length} figure${usable.length === 1 ? "" : "s"}: ` +
      `${survivors[0].organizationName}. Treat this as a strong lead for a conversation, not proof — ` +
      "add another figure to raise confidence further.";
  } else {
    summary =
      `${survivors.length} recipients explain these figures equally well. That is a real ` +
      "tie, not a ranking problem. Add more figures from the leaked copy to separate them.";
  }

  return {
    fiscalYear,
    observations,
    candidates: out,
    survivors,
    markableCount: usable.length,
    summary,
  };
}

/** Would this figure carry a mark at all, for anyone? */
export function isMarkableValue(targetOrgId: string, fieldKey: string, trueValue: number | null): boolean {
  if (trueValue === null) return false;
  // A probe against a stand-in recipient: shiftFor returns 0 for a store's own
  // figures and for anything under the floor, which is exactly what "carries no
  // mark" means.
  return shiftFor({ recipientOrgId: `__probe__${targetOrgId}`, targetOrgId, fieldKey, value: trueValue }) !== 0;
}
