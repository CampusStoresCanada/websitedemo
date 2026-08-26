import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeYear } from "@/lib/actions/benchmarking-metrics";
import { isYearClosedToWrites } from "@/lib/benchmarking/metrics";

export const metadata = {
  title: "Drift on published years | Campus Stores Canada",
};

/**
 * What has changed underneath a published year.
 *
 * A closed year's stored metrics are frozen deliberately — they are the record
 * of what members were sent. But the source data keeps moving: stores correct
 * their own figures for years afterwards, usually because seeing the report is
 * the first time anyone looks closely. KPU's enrolment and Algonquin's were
 * both wrong in the 2025 package and both have since been fixed.
 *
 * That divergence is normal and is not a defect to be reconciled away. What
 * would be a defect is nobody being able to SEE it — a secretary inheriting
 * this in two years should find a record of what moved, not discover it when a
 * member queries a year-over-year figure.
 *
 * So this reports and does not act. There is no repair button, no alert, and
 * no threshold. It is a reading room: the numbers as published, the numbers as
 * they now stand, and the gap between them left visible for whoever has to
 * make the call about how the next cycle treats it.
 */

const FIELD_LABELS: Record<string, string> = {
  total_retail_revenue: "Total retail revenue",
  total_revenue: "Total revenue",
  gross_margin: "Gross margin",
  gross_margin_pct: "Gross margin %",
  net_margin_pct: "Net margin %",
  hr_pct: "Staffing % of revenue",
  online_pct: "Online share %",
  sales_per_fte: "Revenue per student",
  sales_per_sqft: "Revenue per square foot",
  cm_sales_per_fte: "Course materials per student",
};

const fmt = (n: number | null, field: string) => {
  if (n === null) return "—";
  return field.endsWith("_pct")
    ? `${n.toFixed(1)}%`
    : `$${Math.round(n).toLocaleString("en-CA")}`;
};

export default async function BenchmarkingDriftPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/benchmarking");

  const db = createAdminClient();
  const { data: surveys } = await db
    .from("benchmarking_surveys")
    .select("fiscal_year, status")
    .order("fiscal_year", { ascending: false });

  const closed = (surveys ?? []).filter((s) => isYearClosedToWrites(s.status as string));

  const reports = await Promise.all(
    closed.map(async (s) => {
      const res = await recomputeYear(s.fiscal_year as number, { dryRun: true });
      return { fiscalYear: s.fiscal_year as number, summary: res.summary, error: res.error };
    }),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Drift on published years</h1>
      <p className="mt-2 max-w-2xl text-sm text-gray-600">
        A published year&apos;s figures are frozen — they are the record of what members
        were sent. Their source data is not frozen, and stores keep correcting it, often
        because reading the report is the first time anyone looked closely.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-gray-600">
        This page reports that gap and does nothing about it. There is no repair action
        here on purpose: whether a corrected figure or the published one is the right
        baseline for year-over-year is a call for the secretary of the day, not a button.
      </p>

      {closed.length === 0 && (
        <p className="mt-8 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
          No year is closed yet. A year closes when its cycle is marked complete, which is
          when its figures have gone out to members.
        </p>
      )}

      {reports.map((r) => (
        <section key={r.fiscalYear} className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">FY{r.fiscalYear}</h2>
            <span className="text-xs text-gray-500">
              {r.summary
                ? `${r.summary.changed.length} figure${r.summary.changed.length === 1 ? "" : "s"} now differ from what was published`
                : ""}
            </span>
          </div>

          {r.error && <p className="mt-3 text-sm text-red-700">{r.error}</p>}

          {r.summary && r.summary.changed.length === 0 && (
            <p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
              Nothing has moved. The source data still produces exactly the figures that
              were published.
            </p>
          )}

          {r.summary && r.summary.changed.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="pb-2 font-medium">Store</th>
                  <th className="pb-2 font-medium">Measure</th>
                  <th className="pb-2 text-right font-medium">As published</th>
                  <th className="pb-2 text-right font-medium">As it stands</th>
                </tr>
              </thead>
              <tbody>
                {r.summary.changed.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 text-gray-900">{c.organizationName}</td>
                    <td className="py-2 pr-3 text-gray-600">
                      {FIELD_LABELS[c.field] ?? c.field}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-600">
                      {fmt(c.from, c.field)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-900">
                      {fmt(c.to, c.field)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
