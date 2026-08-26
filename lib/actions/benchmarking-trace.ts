"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import {
  buildTraceReport,
  trueValueFor,
  isMarkableValue,
  type TraceInput,
  type TraceReport,
  type ResolvedObservation,
} from "@/lib/benchmarking/trace";
import type { BenchmarkingRow } from "@/lib/benchmarking/comparison";

/**
 * Run a trace against a leaked copy.
 *
 * Admin-only, and deliberately read-only: it records nothing and accuses
 * nobody. A trace is the start of a conversation with a member, so the result
 * is a ranked list with its arithmetic, never a name on its own.
 */
export async function traceLeakedReport(
  fiscalYear: number,
  inputs: TraceInput[],
): Promise<{ success: boolean; error?: string; report?: TraceReport }> {
  const guard = await requireAdmin();
  if (!guard.ok) return { success: false, error: "Not authorized" };

  const clean = inputs.filter((i) => i.organizationId && Number.isFinite(i.observedValue));
  if (clean.length === 0) {
    return { success: false, error: "Enter at least one figure as it appeared in the leaked copy." };
  }

  try {
    const db = createAdminClient();

    const { data: rowsRaw } = await db
      .from("benchmarking")
      .select("*")
      .eq("fiscal_year", fiscalYear)
      .neq("status", "draft");
    const rows = (rowsRaw ?? []) as unknown as BenchmarkingRow[];

    const { data: orgs } = await db
      .from("organizations")
      .select("id, name, fte")
      .in("id", rows.map((r) => r.organization_id));
    const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));

    // Resolve each observation against what the report would actually have
    // shown — same metric definitions, same FTE — or the comparison is against
    // a number no report ever displayed.
    const observations: ResolvedObservation[] = clean.map((i) => {
      const row = rows.find((r) => r.organization_id === i.organizationId);
      const org = orgById.get(i.organizationId);
      const trueValue = trueValueFor(row, i.fieldKey, org?.fte);
      const markable = isMarkableValue(i.organizationId, i.fieldKey, trueValue);
      return {
        ...i,
        organizationName: (org?.name as string) ?? "Unknown store",
        trueValue,
        markable,
        note:
          trueValue === null
            ? "No figure on file for this store and measure, so it cannot be checked."
            : !markable
              ? "Too small to carry a mark — this figure proves nothing either way."
              : null,
      };
    });

    // Who could have held a copy. Two independent sources, and which one a
    // candidate came from is evidence in itself: a store we never logged
    // opening the report is a weaker lead than one we did.
    const { data: viewers } = await db
      .from("benchmarking_report_access")
      .select("recipient_organization_id")
      .eq("survey_fiscal_year", fiscalYear);
    const viewed = new Set((viewers ?? []).map((v) => v.recipient_organization_id as string));

    const { data: recipients } = await db
      .from("benchmarking_recipients")
      .select("organization_id")
      .eq("fiscal_year", fiscalYear);
    const wasSent = new Set((recipients ?? []).map((r) => r.organization_id as string));

    const candidateIds = new Set<string>([...viewed, ...wasSent]);
    // Anyone who filed could also have been shown a comparison.
    for (const r of rows) candidateIds.add(r.organization_id);

    const { data: candOrgs } = await db
      .from("organizations")
      .select("id, name")
      .in("id", Array.from(candidateIds));

    const candidates = (candOrgs ?? []).map((o) => ({
      organizationId: o.id as string,
      organizationName: o.name as string,
      viewedReport: viewed.has(o.id as string),
      wasRecipient: wasSent.has(o.id as string),
    }));

    return {
      success: true,
      report: buildTraceReport({ fiscalYear, observations, candidates }),
    };
  } catch (err) {
    console.error("[traceLeakedReport] failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "Trace failed" };
  }
}
