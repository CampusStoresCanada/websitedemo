import {
  resolveCut,
  explainSuppression,
  type CutMember,
  type DisclosureLevel,
} from "@/lib/benchmarking/disclosure";

/**
 * A store against its peers.
 *
 * This is the surface `resolveCut` was written for. Until now the disclosure
 * choice was a promise with nothing enforcing it: a store could say "never name
 * me" and the rules that make that true had no caller. Every cut below goes
 * through resolveCut before a single peer name is rendered.
 *
 * Three things hold, and they are the whole point:
 *
 *   Aggregates include everybody. A store that opted out of being named still
 *   moves the median — withdrawal governs attribution, not arithmetic, which is
 *   also what makes a late withdrawal cheap enough to allow.
 *
 *   Names are rendered only from `view.named`. Never from the raw member list,
 *   never from "everyone except the opted-out", because the residual rule means
 *   the safe answer is sometimes to name nobody even though most stores are
 *   happy to be named.
 *
 *   A thin cut is withheld with its reason. Silence reads as a bug; the reason
 *   reads as care, and it teaches the member why the number they wanted is not
 *   there.
 */

export type MetricFormat = "currency" | "number" | "percent";

export interface MetricDef {
  key: string;
  label: string;
  format: MetricFormat;
  /** Null when a row lacks the inputs — excluded rather than counted as zero. */
  compute: (row: BenchmarkingRow) => number | null;
  hint?: string;
}

export type BenchmarkingRow = Record<string, unknown> & {
  organization_id: string;
  disclosure_level?: string | null;
};

export interface MetricStat {
  key: string;
  label: string;
  format: MetricFormat;
  hint?: string;
  /** The reader's own figure. Always shown — it is theirs. */
  yours: number | null;
  median: number | null;
  /** How many stores had the inputs for this metric, which is not the cut size. */
  n: number;
  /** Their position, without publishing a league table. */
  standing: "above" | "below" | "at" | null;
}

export interface NamedPeer {
  organizationId: string;
  organizationName: string;
  values: Record<string, number | null>;
}

export interface ComparisonCut {
  key: string;
  label: string;
  bucket: string;
  /** Everyone in the cut, including the reader and the opted-out. */
  cutSize: number;
  showAggregate: boolean;
  suppressionReason: string | null;
  metrics: MetricStat[];
  named: NamedPeer[];
  /** Peers withheld because the reader does not reciprocate. */
  withheldForReciprocity: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

const revenue = (r: BenchmarkingRow): number | null => {
  const inStore = num(r.total_gross_sales_instore);
  const online = num(r.total_online_sales);
  if (inStore === null && online === null) return null;
  return (inStore ?? 0) + (online ?? 0);
};

/**
 * The metrics worth comparing.
 *
 * Ratios rather than raw totals, because a raw total only tells a store it is
 * smaller than a bigger store. Revenue per student is the figure that says
 * something a director can act on.
 */
export const METRICS: MetricDef[] = [
  {
    key: "revenue",
    label: "Total revenue",
    format: "currency",
    compute: revenue,
    hint: "In-store and online combined.",
  },
  {
    key: "revenue_per_student",
    label: "Revenue per student",
    format: "currency",
    compute: (r) => ratio(revenue(r), num(r.enrollment_fte)),
    hint: "Total revenue divided by FTE enrolment — the comparison that survives a size difference.",
  },
  {
    key: "revenue_per_sqft",
    label: "Revenue per square foot",
    format: "currency",
    compute: (r) => ratio(revenue(r), num(r.total_square_footage)),
    hint: "How hard the floor space works.",
  },
  {
    key: "revenue_per_employee",
    label: "Revenue per full-time employee",
    format: "currency",
    compute: (r) => ratio(revenue(r), num(r.fulltime_employees)),
  },
];

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function levelOf(row: BenchmarkingRow): DisclosureLevel {
  return row.disclosure_level === "aggregate_only" ? "aggregate_only" : "full";
}

/**
 * Build one cut for one reader.
 *
 * `rows` is every store in the bucket INCLUDING the reader's own. The reader is
 * never listed among their own peers, but they do count toward the cut size and
 * the median — they are part of the population being described.
 */
export function buildCut(input: {
  key: string;
  label: string;
  bucket: string;
  rows: BenchmarkingRow[];
  nameById: Map<string, string>;
  viewerOrgId: string;
  metrics?: MetricDef[];
  minCutSize?: number;
}): ComparisonCut {
  const { key, label, bucket, rows, nameById, viewerOrgId } = input;
  const metricDefs = input.metrics ?? METRICS;

  const members: CutMember[] = rows.map((r) => ({
    organizationId: r.organization_id,
    organizationName: nameById.get(r.organization_id) ?? "A member store",
    disclosureLevel: levelOf(r),
  }));

  const viewerRow = rows.find((r) => r.organization_id === viewerOrgId) ?? null;
  const viewerDisclosure: DisclosureLevel = viewerRow ? levelOf(viewerRow) : "full";

  const view = resolveCut({
    members,
    viewerDisclosure,
    minCutSize: input.minCutSize,
  });

  const metrics: MetricStat[] = metricDefs.map((m) => {
    const yours = viewerRow ? m.compute(viewerRow) : null;

    // Every contributing store feeds the median, opted-out included.
    const values = view.contributing
      .map((c) => rows.find((r) => r.organization_id === c.organizationId))
      .map((r) => (r ? m.compute(r) : null))
      .filter((v): v is number => v !== null);

    const med = view.showAggregate ? median(values) : null;

    return {
      key: m.key,
      label: m.label,
      format: m.format,
      hint: m.hint,
      yours,
      median: med,
      n: values.length,
      standing:
        yours === null || med === null
          ? null
          : yours > med
            ? "above"
            : yours < med
              ? "below"
              : "at",
    };
  });

  // Names come from view.named and nowhere else. The reader is dropped from
  // their own peer list — they are looking at themselves in the "yours" column.
  const named: NamedPeer[] = view.named
    .filter((m) => m.organizationId !== viewerOrgId)
    .map((m) => {
      const row = rows.find((r) => r.organization_id === m.organizationId)!;
      return {
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        values: Object.fromEntries(metricDefs.map((d) => [d.key, d.compute(row)])),
      };
    });

  return {
    key,
    label,
    bucket,
    cutSize: members.length,
    showAggregate: view.showAggregate,
    suppressionReason: explainSuppression(view),
    metrics,
    named,
    withheldForReciprocity: view.withheldForReciprocity,
  };
}

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null) return "—";
  switch (format) {
    case "currency":
      return `$${Math.round(value).toLocaleString("en-CA")}`;
    case "percent":
      return `${Number(value.toFixed(1))}%`;
    default:
      return Math.round(value).toLocaleString("en-CA");
  }
}

/**
 * Comparison regions. NOT the same buckets the recipient queue uses.
 *
 * A province is a regulatory jurisdiction — Ontario stores operate under
 * Ontario tuition rules, Ontario procurement and Ontario funding — so it is a
 * genuine peer group whatever its headcount. Quebec stays its own group here
 * even though it is only two stores, and those two will be perfectly aware they
 * are an odd pair; that is not a fact worth hiding from them.
 *
 * The rep patches merge Quebec into Atlantic, because a patch is a workload
 * rather than a jurisdiction. See app/benchmarking/recipients/page.tsx.
 */
export const REGION_OF: Record<string, string> = {
  "Newfoundland and Labrador": "Atlantic",
  "Nova Scotia": "Atlantic",
  "New Brunswick": "Atlantic",
  "Prince Edward Island": "Atlantic",
  Quebec: "Quebec",
  Ontario: "Ontario",
  Manitoba: "Prairies",
  Saskatchewan: "Prairies",
  Alberta: "Prairies",
  "British Columbia": "West",
  Yukon: "West",
  "Northwest Territories": "West",
  Nunavut: "West",
};
