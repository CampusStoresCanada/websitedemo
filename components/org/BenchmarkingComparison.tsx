"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BenchmarkingWithOrg } from "@/lib/data";
import { ProtectedSection, BlurredValue } from "@/components/ui/GreyBlur";

interface BenchmarkingComparisonProps {
  allBenchmarking: BenchmarkingWithOrg[];
  currentOrgId: string;
}

type SortField =
  | 'name'
  | 'institution_type'
  | 'enrollment_fte'
  | 'total_square_footage'
  | 'total_sales'
  | 'online_pct'
  | 'gross_margin'
  | 'hr_pct'
  | 'net_margin'
  | 'sales_per_student';

type SortDirection = 'asc' | 'desc';
type PeerGroup = 'all' | 'type' | 'mandate' | 'size';

// ── Peer group helpers ────────────────────────────────────────────────────────

function enrollmentTier(fte: number | null | undefined): string {
  if (!fte) return 'Unknown';
  if (fte <= 1500) return 'XSmall';
  if (fte <= 2500) return 'Small';
  if (fte <= 5000) return 'Medium';
  if (fte <= 15000) return 'Large';
  return 'XLarge';
}

// ── Quartile helpers ──────────────────────────────────────────────────────────

type Quartile = 'gold' | 'green' | 'neutral' | 'red';

/**
 * Returns which quartile a value falls in relative to an array of peers.
 * Higher rank = better (gold). Pass `invert=true` for cost metrics where lower is better.
 */
function getQuartile(values: number[], value: number, invert = false): Quartile {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length < 4) return 'neutral'; // not enough data to rank
  const sorted = [...valid].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  const pct = below / sorted.length; // 0 = lowest, ~1 = highest

  const rank = invert ? 1 - pct : pct;
  if (rank >= 0.75) return 'gold';
  if (rank >= 0.50) return 'green';
  if (rank >= 0.25) return 'neutral';
  return 'red';
}

function quartileBg(q: Quartile): string {
  switch (q) {
    case 'gold':    return 'bg-amber-50';
    case 'green':   return 'bg-green-50';
    case 'neutral': return '';
    case 'red':     return 'bg-red-50';
  }
}

function quartileDot(q: Quartile): string {
  switch (q) {
    case 'gold':    return 'text-amber-500';
    case 'green':   return 'text-green-500';
    case 'neutral': return 'text-gray-300';
    case 'red':     return 'text-red-400';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BenchmarkingComparison({
  allBenchmarking,
  currentOrgId,
}: BenchmarkingComparisonProps) {
  const [sortField, setSortField] = useState<SortField>('total_sales');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [peerGroup, setPeerGroup] = useState<PeerGroup>('all');

  // Current org's attributes for peer group matching
  const currentOrg = useMemo(
    () => allBenchmarking.find((b) => b.organization_id === currentOrgId),
    [allBenchmarking, currentOrgId]
  );

  // Compute derived metrics for all rows
  const withMetrics = useMemo(() => {
    return allBenchmarking.map((b) => {
      const totalSales = (b.total_gross_sales_instore || 0) + (b.total_online_sales || 0);
      const cogs = b.total_cogs || 0;
      const grossMargin = totalSales > 0 ? ((totalSales - cogs) / totalSales) * 100 : null;
      const netMargin = totalSales > 0 ? ((b.net_profit || 0) / totalSales) * 100 : null;
      const onlinePct = totalSales > 0 ? ((b.total_online_sales || 0) / totalSales) * 100 : null;
      const hrPct = totalSales > 0 ? ((b.expense_hr || 0) / totalSales) * 100 : null;
      const salesPerStudent = b.enrollment_fte ? totalSales / b.enrollment_fte : null;
      return { ...b, totalSales, grossMargin, netMargin, onlinePct, hrPct, salesPerStudent };
    });
  }, [allBenchmarking]);

  // Filter by selected peer group
  const filteredData = useMemo(() => {
    if (peerGroup === 'all' || !currentOrg) return withMetrics;
    return withMetrics.filter((b) => {
      switch (peerGroup) {
        case 'type':
          return b.institution_type === currentOrg.institution_type;
        case 'mandate':
          return b.operations_mandate === currentOrg.operations_mandate;
        case 'size':
          return enrollmentTier(b.enrollment_fte) === enrollmentTier(currentOrg.enrollment_fte);
        default:
          return true;
      }
    });
  }, [withMetrics, peerGroup, currentOrg]);

  // Compute quartile maps within the filtered set
  const quartileMaps = useMemo(() => {
    const extract = (key: keyof typeof filteredData[0]) =>
      filteredData.map((r) => r[key] as number | null).filter((v): v is number => v !== null);

    return {
      totalSales:    extract('totalSales'),
      grossMargin:   extract('grossMargin'),
      hrPct:         extract('hrPct'),
      netMargin:     extract('netMargin'),
      onlinePct:     extract('onlinePct'),
      salesPerStudent: extract('salesPerStudent'),
      total_square_footage: extract('total_square_footage'),
      enrollment_fte: extract('enrollment_fte'),
    };
  }, [filteredData]);

  // Sort
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortField) {
        case 'name':             aVal = a.organization?.name || ''; bVal = b.organization?.name || ''; break;
        case 'institution_type': aVal = a.institution_type || '';    bVal = b.institution_type || '';   break;
        case 'enrollment_fte':   aVal = a.enrollment_fte;            bVal = b.enrollment_fte;           break;
        case 'total_square_footage': aVal = a.total_square_footage;  bVal = b.total_square_footage;     break;
        case 'total_sales':      aVal = a.totalSales;                bVal = b.totalSales;               break;
        case 'online_pct':       aVal = a.onlinePct;                 bVal = b.onlinePct;                break;
        case 'gross_margin':     aVal = a.grossMargin;               bVal = b.grossMargin;              break;
        case 'hr_pct':           aVal = a.hrPct;                     bVal = b.hrPct;                    break;
        case 'net_margin':       aVal = a.netMargin;                 bVal = b.netMargin;                break;
        case 'sales_per_student': aVal = a.salesPerStudent;          bVal = b.salesPerStudent;          break;
      }

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [filteredData, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Peer group tab config
  const peerGroupTabs: { key: PeerGroup; label: string; sublabel: string }[] = [
    { key: 'all',     label: 'All',      sublabel: `${withMetrics.length}` },
    { key: 'type',    label: 'Same Type', sublabel: currentOrg?.institution_type?.slice(0, 4) ?? '—' },
    { key: 'mandate', label: 'Mandate',   sublabel: currentOrg?.operations_mandate?.split('-')[0] ?? '—' },
    { key: 'size',    label: 'Size',      sublabel: enrollmentTier(currentOrg?.enrollment_fte) },
  ];

  const SortHeader = ({
    field,
    children,
    className = '',
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-gray-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </th>
  );

  // Helper: quartile cell class for a given metric value
  const qClass = (
    values: number[],
    value: number | null | undefined,
    invert = false
  ): string => {
    if (value == null) return '';
    return quartileBg(getQuartile(values, value, invert));
  };

  return (
    <ProtectedSection requiredPermission="survey_participant">
      <div className="space-y-4">
        {/* Header + peer group tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
              Peer Comparison
            </h3>
            <p className="text-xs text-gray-400">
              {sortedData.length} institutions · click headers to sort
            </p>
          </div>

          <div className="flex gap-1">
            {peerGroupTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setPeerGroup(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  peerGroup === tab.key
                    ? 'bg-[#163D6D] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
                <span className={`ml-1 ${peerGroup === tab.key ? 'text-white/70' : 'text-gray-400'}`}>
                  ({tab.sublabel})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Quartile legend */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="font-medium">Quartile:</span>
          {([ ['gold', 'Top 25%'], ['green', 'Top 50%'], ['neutral', 'Bottom 50%'], ['red', 'Bottom 25%'] ] as [Quartile, string][]).map(([q, label]) => (
            <span key={q} className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-sm inline-block ${q === 'neutral' ? 'bg-gray-100 border border-gray-200' : quartileBg(q)}`} />
              {label}
            </span>
          ))}
          <span className="text-gray-400 ml-1">· HR% inverted (lower = better)</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <SortHeader field="name" className="min-w-[160px]">Institution</SortHeader>
                <SortHeader field="institution_type">Type</SortHeader>
                <SortHeader field="enrollment_fte">FTE</SortHeader>
                <SortHeader field="total_sales">Sales</SortHeader>
                <SortHeader field="online_pct">Online%</SortHeader>
                <SortHeader field="gross_margin">GM%</SortHeader>
                <SortHeader field="hr_pct">HR%</SortHeader>
                <SortHeader field="net_margin">Net%</SortHeader>
                <SortHeader field="sales_per_student">$/Student</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => {
                const isCurrentOrg = row.organization_id === currentOrgId;
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors ${
                      isCurrentOrg
                        ? 'outline outline-2 outline-[#163D6D] outline-offset-[-2px] relative'
                        : 'hover:bg-gray-50/60'
                    }`}
                  >
                    {/* Institution name */}
                    <td className={`px-3 py-2 ${isCurrentOrg ? 'bg-blue-50' : ''}`}>
                      <BlurredValue placeholderWidth={16}>
                        <Link
                          href={`/org/${row.organization?.slug}`}
                          className={`hover:underline text-sm ${
                            isCurrentOrg ? 'font-semibold text-[#163D6D]' : 'text-[#1A1A1A]'
                          }`}
                        >
                          {row.organization?.name || 'Unknown'}
                        </Link>
                        {isCurrentOrg && (
                          <span className="ml-1.5 text-[10px] font-semibold bg-[#163D6D] text-white px-1.5 py-0.5 rounded-full align-middle">
                            YOU
                          </span>
                        )}
                      </BlurredValue>
                    </td>

                    {/* Type */}
                    <td className={`px-3 py-2 text-gray-500 text-xs ${isCurrentOrg ? 'bg-blue-50' : ''}`}>
                      <BlurredValue placeholderWidth={4}>
                        {formatInstitutionType(row.institution_type)}
                      </BlurredValue>
                    </td>

                    {/* FTE */}
                    <td className={`px-3 py-2 text-gray-700 ${isCurrentOrg ? 'bg-blue-50' : ''}`}>
                      <BlurredValue placeholderWidth={6}>
                        {row.enrollment_fte?.toLocaleString() || '—'}
                      </BlurredValue>
                    </td>

                    {/* Total Sales */}
                    <td className={`px-3 py-2 font-medium ${qClass(quartileMaps.totalSales, row.totalSales)}`}>
                      <BlurredValue placeholderWidth={7}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.totalSales != null ? getQuartile(quartileMaps.totalSales, row.totalSales) : null} />
                          {formatCurrency(row.totalSales)}
                        </span>
                      </BlurredValue>
                    </td>

                    {/* Online % */}
                    <td className={`px-3 py-2 ${qClass(quartileMaps.onlinePct, row.onlinePct)}`}>
                      <BlurredValue placeholderWidth={4}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.onlinePct != null ? getQuartile(quartileMaps.onlinePct, row.onlinePct) : null} />
                          {row.onlinePct != null ? `${row.onlinePct.toFixed(1)}%` : '—'}
                        </span>
                      </BlurredValue>
                    </td>

                    {/* Gross Margin % */}
                    <td className={`px-3 py-2 ${qClass(quartileMaps.grossMargin, row.grossMargin)}`}>
                      <BlurredValue placeholderWidth={4}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.grossMargin != null ? getQuartile(quartileMaps.grossMargin, row.grossMargin) : null} />
                          {row.grossMargin != null ? `${row.grossMargin.toFixed(1)}%` : '—'}
                        </span>
                      </BlurredValue>
                    </td>

                    {/* HR % — inverted (lower is better) */}
                    <td className={`px-3 py-2 ${qClass(quartileMaps.hrPct, row.hrPct, true)}`}>
                      <BlurredValue placeholderWidth={4}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.hrPct != null ? getQuartile(quartileMaps.hrPct, row.hrPct, true) : null} />
                          {row.hrPct != null ? `${row.hrPct.toFixed(1)}%` : '—'}
                        </span>
                      </BlurredValue>
                    </td>

                    {/* Net Margin % */}
                    <td className={`px-3 py-2 ${qClass(quartileMaps.netMargin, row.netMargin)}`}>
                      <BlurredValue placeholderWidth={4}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.netMargin != null ? getQuartile(quartileMaps.netMargin, row.netMargin) : null} />
                          {row.netMargin != null ? `${row.netMargin.toFixed(1)}%` : '—'}
                        </span>
                      </BlurredValue>
                    </td>

                    {/* Sales per Student */}
                    <td className={`px-3 py-2 ${qClass(quartileMaps.salesPerStudent, row.salesPerStudent)}`}>
                      <BlurredValue placeholderWidth={5}>
                        <span className="flex items-center gap-1">
                          <QuartileDot q={row.salesPerStudent != null ? getQuartile(quartileMaps.salesPerStudent, row.salesPerStudent) : null} />
                          {row.salesPerStudent != null ? `$${Math.round(row.salesPerStudent).toLocaleString()}` : '—'}
                        </span>
                      </BlurredValue>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400">
          Quartile rankings recompute within the selected peer group. GM% = gross margin. HR% = HR expense as % of sales (lower is better).
        </p>
      </div>
    </ProtectedSection>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QuartileDot({ q }: { q: Quartile | null }) {
  if (!q) return null;
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
    q === 'gold' ? 'bg-amber-400' :
    q === 'green' ? 'bg-green-400' :
    q === 'neutral' ? 'bg-gray-200' :
    'bg-red-400'
  }`} />;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatInstitutionType(type: string | null): string {
  if (!type) return '—';
  switch (type) {
    case 'University':   return 'Univ';
    case 'College':      return 'Coll';
    case 'Polytechnic':  return 'Poly';
    default:             return type.slice(0, 4);
  }
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${prefix}$${(abs / 1_000).toFixed(0)}K`;
  return `${prefix}$${abs.toLocaleString()}`;
}
