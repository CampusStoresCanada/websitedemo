
/**
 * The KPI computation for one store, one year.
 *
 * WHY THIS EXISTS AT ALL. computed_metrics has been sitting in the database
 * with 39 rows since the 2025 Excel backfill and nothing in the codebase read
 * or wrote it. Every surface that needed a ratio recomputed it inline from raw
 * columns instead, which is how the comparison view ended up offering four
 * measures where the brief defines ten.
 *
 * THE STORED 2025 ROWS ARE STALE, NOT AUTHORITATIVE. They were computed from
 * raw values that have since been corrected, so they are a record of what was
 * published, not of what is true:
 *
 *   Capilano's total_retail_revenue reads 12,335,839 against a raw
 *   2,335,839 — a ten-million digit slip that carried into its margin, its
 *   sales per FTE and its sales per square foot.
 *
 *   total_square_footage was later revised for most stores. The stored
 *   sales_per_sqft implies exactly twice the current footage for Algonquin,
 *   Ambrose, Champlain and Conestoga.
 *
 *   Algonquin's stored sales_per_fte implies 7,532 FTE against a current
 *   20,169.
 *
 * So this recomputes from source rather than trying to reproduce them. Where
 * the raw data has NOT changed, these formulas agree with the backfill on all
 * 39 rows — that agreement is what pins them, and it is asserted in the tests.
 *
 * PERCENTAGES ARE STORED AS PERCENTAGES. 32.99 means 32.99%, matching the
 * backfill and the column names. Storing a fraction in a column called
 * `_pct` is the kind of thing that reads fine forever and renders 3299%.
 */

export interface MetricSourceRow {
  total_gross_sales_instore?: unknown;
  total_online_sales?: unknown;
  ia_revenue?: unknown;
  other_non_retail_revenue?: unknown;
  total_cogs?: unknown;
  net_profit?: unknown;
  expense_hr?: unknown;
  enrollment_fte?: unknown;
  total_square_footage?: unknown;
  sales_course_materials?: unknown;
  total_transaction_count?: unknown;
  adoptions_by_deadline?: unknown;
  total_course_sections?: unknown;
  tracks_adoptions?: unknown;
  fye_inventory_value?: unknown;
}

export interface ComputedMetrics {
  total_retail_revenue: number | null;
  total_revenue: number | null;
  gross_margin: number | null;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  hr_pct: number | null;
  online_pct: number | null;
  sales_per_fte: number | null;
  sales_per_sqft: number | null;
  cm_sales_per_fte: number | null;
  avg_transaction_value: number | null;
  adoption_completion_rate: number | null;
  gmroi: number | null;
  inventory_turns: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The one FTE figure everything divides by.
 *
 * ONE NUMBER EVERYWHERE. The FTE a store reports through benchmarking is what
 * sets its dues for the year ahead — submitBenchmarkingSurvey writes it
 * straight onto organizations.fte — so organizations.fte is not a second
 * opinion, it is that same answer after any deliberate correction an admin has
 * made on top (flagged by fte_is_manual_override, and cleared by the next
 * submission).
 *
 * So the org figure wins. Dividing by the raw survey answer while the store is
 * banded and billed on the corrected one publishes a ratio that contradicts
 * the store's own invoice — Kwantlen answered 2,792 against a corrected 12,000
 * and appeared at $1,157 revenue per student against a $315 median, an
 * outlier invented entirely by the denominator.
 *
 * Falls back to the row's own answer only when the org has no figure at all.
 */
export function effectiveFte(orgFte: unknown, rowFte: unknown): number | null {
  const o = num(orgFte);
  if (o !== null) return o;
  return num(rowFte);
}

/** Division that refuses rather than returning Infinity or NaN. */
const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

const pct = (a: number | null, b: number | null): number | null => {
  const r = div(a, b);
  return r === null ? null : r * 100;
};

/**
 * Sum where "nobody answered" and "answered zero" stay distinguishable.
 *
 * Returns null only when every part is missing. A store that reports in-store
 * sales and leaves online blank has $0 online, not unknown revenue — but a
 * store that reports neither has no revenue figure at all, and calling that $0
 * would drag every median it touches.
 */
const sumOrNull = (...vals: (number | null)[]): number | null => {
  const present = vals.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
};

export interface ComputeOptions {
  /** organizations.fte — the priced figure. See effectiveFte. */
  orgFte?: unknown;
  /** Prior year's FYE inventory, for the two-year averages. */
  priorFyeInventory?: unknown;
}

export function computeMetrics(
  row: MetricSourceRow,
  opts: ComputeOptions = {},
): ComputedMetrics {
  const inStore = num(row.total_gross_sales_instore);
  const online = num(row.total_online_sales);
  const retail = sumOrNull(inStore, online);

  // Non-retail streams are a 2026 addition, so this equals retail for every
  // 2025 row and starts to diverge the first time a store reports them.
  const nonRetail = sumOrNull(num(row.ia_revenue), num(row.other_non_retail_revenue));
  const total = retail === null && nonRetail === null ? null : (retail ?? 0) + (nonRetail ?? 0);

  const cogs = num(row.total_cogs);
  const grossMargin = total === null || cogs === null ? null : total - cogs;

  // One FTE everywhere — the same figure dues are charged on.
  const fte = effectiveFte(opts.orgFte, row.enrollment_fte);

  // GMROI and turns need an AVERAGE inventory across two year-ends, so they
  // stay null until a prior year exists. Using a single year-end as if it were
  // the average would publish a number that looks like a KPI and is not one.
  const fyeNow = num(row.fye_inventory_value);
  const fyePrior = num(opts.priorFyeInventory);
  const avgInventory =
    fyeNow === null || fyePrior === null ? null : (fyeNow + fyePrior) / 2;

  // Only stores that say they track adoptions get a completion rate. A store
  // that does not track them reports 0 by-deadline, and 0% would read as a
  // catastrophic result rather than an absent one.
  const tracks = row.tracks_adoptions === true;

  return {
    total_retail_revenue: retail,
    total_revenue: total,
    gross_margin: grossMargin,
    gross_margin_pct: pct(grossMargin, total),
    net_margin_pct: pct(num(row.net_profit), total),
    hr_pct: pct(num(row.expense_hr), total),
    // Against RETAIL revenue, per the brief — an online share of a total that
    // includes non-retail streams would shrink as a store diversifies.
    online_pct: pct(online, retail),
    sales_per_fte: div(total, fte),
    sales_per_sqft: div(total, num(row.total_square_footage)),
    cm_sales_per_fte: div(num(row.sales_course_materials), fte),
    avg_transaction_value: div(total, num(row.total_transaction_count)),
    adoption_completion_rate: tracks
      ? pct(num(row.adoptions_by_deadline), num(row.total_course_sections))
      : null,
    gmroi: div(grossMargin, avgInventory),
    inventory_turns: div(cogs, avgInventory),
  };
}

/** The metrics that carry a year-over-year delta. */
export const YOY_METRICS = [
  "total_revenue",
  "gross_margin_pct",
  "net_margin_pct",
  "hr_pct",
  "online_pct",
  "sales_per_fte",
  "sales_per_sqft",
] as const;

export type YoyMetric = (typeof YOY_METRICS)[number];

/**
 * Year-over-year movement.
 *
 * Percentages move by PERCENTAGE POINTS (a margin going 30% -> 33% is +3),
 * while money and ratios move by percent change. Reporting a margin's change
 * as a percent of itself — "+10%" for that same move — is the classic way a
 * benchmarking report gets quietly argued with in a board meeting.
 */
export function yoyDeltas(
  current: ComputedMetrics,
  prior: ComputedMetrics | null,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of YOY_METRICS) {
    const now = current[key];
    const was = prior?.[key] ?? null;
    if (now === null || was === null) {
      out[`yoy_${key}_delta`] = null;
      continue;
    }
    out[`yoy_${key}_delta`] = key.endsWith("_pct")
      ? now - was
      : was === 0
        ? null
        : ((now - was) / Math.abs(was)) * 100;
  }
  return out;
}


/**
 * Statuses after which a year's stored metrics are history, not working data.
 *
 * Read from the survey's own status rather than a year number or a date, so
 * the rule keeps working every year without anyone remembering to move a
 * cutoff.
 */
export const CLOSED_TO_WRITES = ["complete"] as const;

/**
 * May this year's computed_metrics still be rewritten?
 *
 * A completed cycle's figures have gone out to members in a package. Rewriting
 * them from today's corrected source would leave the database quietly
 * disagreeing with the report people were sent, with nothing recording that it
 * ever matched. Restating a published year is a decision with a covering note,
 * not a side effect of refreshing a table.
 */
export function isYearClosedToWrites(surveyStatus: string | null | undefined): boolean {
  if (!surveyStatus) return false;
  return (CLOSED_TO_WRITES as readonly string[]).includes(surveyStatus);
}
