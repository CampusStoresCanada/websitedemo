"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import { computeMetrics, yoyDeltas, type ComputedMetrics } from "@/lib/benchmarking/metrics";
import { resolveSizeBand, getSizeBands } from "@/lib/benchmarking/size-band";
import { REGION_OF } from "@/lib/benchmarking/comparison";

/**
 * Keeping computed_metrics true.
 *
 * The table went stale because nothing ever recomputed it: the 2025 rows were
 * written once by the Excel backfill and then the raw data was corrected
 * underneath them. A derived table with no writer is worse than no table,
 * because it looks authoritative.
 *
 * So there are exactly two ways a row gets written, and no third:
 *
 *   recomputeYear(), below, which rebuilds a whole year from source.
 *   syncMetricsFor(), called whenever one submission changes.
 *
 * Both go through the same computeMetrics(), so the live comparison and the
 * stored table can never disagree about what a margin is.
 *
 * Recompute is IDEMPOTENT and derives everything it writes. Running it twice
 * changes nothing; running it after a data correction is how the correction
 * reaches the reports.
 */

export interface RecomputeSummary {
  fiscalYear: number;
  examined: number;
  written: number;
  changed: { organizationName: string; field: string; from: number | null; to: number | null }[];
  dryRun: boolean;
}

/** Numeric fields worth reporting a change on, with the tolerance that counts. */
const COMPARE_FIELDS: (keyof ComputedMetrics)[] = [
  "total_retail_revenue",
  "total_revenue",
  "gross_margin",
  "gross_margin_pct",
  "net_margin_pct",
  "hr_pct",
  "online_pct",
  "sales_per_fte",
  "sales_per_sqft",
  "cm_sales_per_fte",
];

const differs = (a: number | null, b: number | null) => {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > 0.01;
};

async function loadYear(fiscalYear: number) {
  const db = createAdminClient();

  const { data: rows } = await db
    .from("benchmarking")
    .select("*")
    .eq("fiscal_year", fiscalYear)
    .neq("status", "draft");

  const orgIds = (rows ?? []).map((r) => r.organization_id as string);

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, province, fte")
    .in("id", orgIds.length ? orgIds : ["00000000-0000-0000-0000-000000000000"]);

  // Prior year, for the two-year inventory averages and the YoY deltas.
  const { data: priorRows } = await db
    .from("benchmarking")
    .select("*")
    .eq("fiscal_year", fiscalYear - 1)
    .neq("status", "draft");

  return { db, rows: rows ?? [], orgs: orgs ?? [], priorRows: priorRows ?? [] };
}

/**
 * Rebuild every metric row for one year from current source data.
 *
 * `dryRun` reports what WOULD change without writing. Use it first on a year
 * that already has published figures — the 2025 rows differ from source in
 * ways that are corrections, and someone should see the list before the
 * numbers behind an already-sent package move.
 */
export async function recomputeYear(
  fiscalYear: number,
  options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; error?: string; summary?: RecomputeSummary }> {
  const guard = await requireAdmin();
  if (!guard.ok) return { success: false, error: "Not authorized" };

  const dryRun = options.dryRun ?? false;

  try {
    const { db, rows, orgs, priorRows } = await loadYear(fiscalYear);
    const bands = await getSizeBands();

    const orgById = new Map(orgs.map((o) => [o.id as string, o]));
    const priorByOrg = new Map(priorRows.map((r) => [r.organization_id as string, r]));

    const { data: existingRows } = await db
      .from("computed_metrics")
      .select("*")
      .eq("fiscal_year", fiscalYear);
    const existingByBenchmarking = new Map(
      (existingRows ?? []).map((e) => [e.benchmarking_id as string, e]),
    );

    const changed: RecomputeSummary["changed"] = [];
    const payloads: Record<string, unknown>[] = [];

    for (const row of rows) {
      const org = orgById.get(row.organization_id as string);
      const prior = priorByOrg.get(row.organization_id as string) ?? null;

      const metrics = computeMetrics(row, {
        orgFte: org?.fte,
        priorFyeInventory: prior?.fye_inventory_value,
      });

      const priorMetrics = prior
        ? computeMetrics(prior, { orgFte: org?.fte })
        : null;

      const existing = existingByBenchmarking.get(row.id as string);
      if (existing) {
        for (const f of COMPARE_FIELDS) {
          const was = existing[f] === null || existing[f] === undefined ? null : Number(existing[f]);
          if (differs(was, metrics[f])) {
            changed.push({
              organizationName: (org?.name as string) ?? "Unknown store",
              field: f,
              from: was,
              to: metrics[f],
            });
          }
        }
      }

      payloads.push({
        benchmarking_id: row.id,
        organization_id: row.organization_id,
        fiscal_year: fiscalYear,
        ...metrics,
        // size_tier is rebuilt from the dues bands. The backfilled values are
        // not reproducible — their ranges overlap — so they are replaced
        // rather than preserved.
        size_tier: resolveSizeBand(org?.fte ?? null, bands)?.label ?? null,
        region: REGION_OF[(org?.province as string) ?? ""] ?? null,
        ...yoyDeltas(metrics, priorMetrics),
        computed_at: new Date().toISOString(),
      });
    }

    if (dryRun) {
      return {
        success: true,
        summary: { fiscalYear, examined: rows.length, written: 0, changed, dryRun: true },
      };
    }

    const { error } = await db
      .from("computed_metrics")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payloads as any, { onConflict: "benchmarking_id" });

    if (error) {
      console.error("[recomputeYear] upsert failed:", error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      summary: { fiscalYear, examined: rows.length, written: payloads.length, changed, dryRun: false },
    };
  } catch (err) {
    console.error("[recomputeYear] failed:", err);
    return { success: false, error: err instanceof Error ? err.message : "Recompute failed" };
  }
}

/**
 * Refresh one store's metrics after its submission changes.
 *
 * Fire-and-forget by design at the call site: a store must never see "failed
 * to submit" because a derived table was briefly unavailable. A missed refresh
 * is recoverable by recomputeYear; a refused submission is not.
 */
export async function syncMetricsFor(benchmarkingId: string): Promise<void> {
  const db = createAdminClient();

  const { data: row } = await db
    .from("benchmarking")
    .select("*")
    .eq("id", benchmarkingId)
    .maybeSingle();
  if (!row) return;

  const { data: org } = await db
    .from("organizations")
    .select("id, name, province, fte")
    .eq("id", row.organization_id as string)
    .maybeSingle();

  const { data: prior } = await db
    .from("benchmarking")
    .select("*")
    .eq("organization_id", row.organization_id as string)
    .eq("fiscal_year", (row.fiscal_year as number) - 1)
    .neq("status", "draft")
    .maybeSingle();

  const bands = await getSizeBands();
  const metrics = computeMetrics(row, {
    orgFte: org?.fte,
    priorFyeInventory: prior?.fye_inventory_value,
  });
  const priorMetrics = prior ? computeMetrics(prior, { orgFte: org?.fte }) : null;

  const { error } = await db.from("computed_metrics").upsert(
    {
      benchmarking_id: row.id,
      organization_id: row.organization_id,
      fiscal_year: row.fiscal_year,
      ...metrics,
      size_tier: resolveSizeBand(org?.fte ?? null, bands)?.label ?? null,
      region: REGION_OF[(org?.province as string) ?? ""] ?? null,
      ...yoyDeltas(metrics, priorMetrics),
      computed_at: new Date().toISOString(),
    },
    { onConflict: "benchmarking_id" },
  );

  if (error) console.warn("[syncMetricsFor] upsert failed:", error.message);
}
