/**
 * A store's figures over time, for whoever eventually draws the chart.
 *
 * ⛔ Plain module, no database. Two rules, decided by the ED, that are easy to
 * lose once a charting library is involved:
 *
 *   1. A trend contains RELEASED years only. Not even the store's own
 *      unreleased filing, which it can already read on its profile as a single
 *      year. A line that moves when one store submits is not a trend, it is a
 *      preview of one.
 *
 *   2. Fewer than two points is not a trend. A single dot on an axis reads as a
 *      finding and is nothing of the kind, so the answer is null and the caller
 *      renders nothing at all rather than a chart with one mark on it.
 */

export interface TrendPoint {
  fiscalYear: number;
  value: number;
}

export function buildTrend(
  rows: { fiscal_year?: number | null }[],
  released: number[],
  value: (row: { fiscal_year?: number | null }) => number | null,
): TrendPoint[] | null {
  const points = rows
    .filter((r) => typeof r.fiscal_year === "number" && released.includes(r.fiscal_year))
    .map((r) => ({ fiscalYear: r.fiscal_year as number, value: value(r) }))
    .filter((p): p is TrendPoint => typeof p.value === "number")
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

  return points.length >= MIN_TREND_POINTS ? points : null;
}

/** Below this there is no line to draw, only a dot pretending to be one. */
export const MIN_TREND_POINTS = 2;
