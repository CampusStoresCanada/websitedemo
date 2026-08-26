"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import {
  computeMetrics,
  yoyDeltas,
  isYearClosedToWrites,
  type ComputedMetrics,
} from "@/lib/benchmarking/metrics";
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

/**
 * A completed year is closed to writes. Permanently.
 *
 * The 2025 figures went out to members in a package. Recomputing them from
 * today's corrected source data would change 33 of the 39 stores — every
 * revised square footage, Algonquin's FTE, Capilano's ten-million slip — so
 * the database would quietly stop matching the report people were sent, with
 * no record that it ever did.
 *
 * That is not a correction anyone asked for. If a published year genuinely
 * needs restating, that is a decision with a covering note to members, not a
 * side effect of someone refreshing a table.
 *
 * The rule reads the survey's own status rather than a year number or a date,
 * so it keeps working every year without anyone remembering to move a cutoff:
 * once a cycle is marked complete, its stored metrics are history.
 */
async function yearIsClosed(fiscalYear: number): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_surveys")
    .select("status")
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();
  return isYearClosedToWrites(data?.status as string | null);
}

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

  if (!dryRun && (await yearIsClosed(fiscalYear))) {
    return {
      success: false,
      error:
        `FY${fiscalYear} is complete — its figures have already gone out to members, ` +
        `so the stored metrics are a record of what was published and cannot be ` +
        `rewritten here. Run with dryRun to see what current source data would produce.`,
    };
  }

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

  // A closed year is closed to every writer, not just the bulk one — otherwise
  // re-submitting a single 2025 row walks straight past the rule.
  if (await yearIsClosed(row.fiscal_year as number)) return;

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
