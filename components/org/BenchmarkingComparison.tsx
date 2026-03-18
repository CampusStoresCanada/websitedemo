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
  | 'online_sales'
  | 'net_profit'
  | 'sales_per_sqft'
  | 'sales_per_student'
  | 'profit_margin';

type SortDirection = 'asc' | 'desc';

export default function BenchmarkingComparison({
  allBenchmarking,
  currentOrgId,
}: BenchmarkingComparisonProps) {
  const [sortField, setSortField] = useState<SortField>('total_sales');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Calculate derived metrics and sort
  const sortedData = useMemo(() => {
    const withMetrics = allBenchmarking.map((b) => {
      const totalSales = (b.total_gross_sales_instore || 0) + (b.total_online_sales || 0);
      const salesPerSqFt = b.total_square_footage ? totalSales / b.total_square_footage : null;
      const salesPerStudent = b.enrollment_fte ? totalSales / b.enrollment_fte : null;
      const profitMargin = totalSales > 0 ? ((b.net_profit || 0) / totalSales) * 100 : null;

      return {
        ...b,
        totalSales,
        salesPerSqFt,
        salesPerStudent,
        profitMargin,
      };
    });

    return withMetrics.sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortField) {
        case 'name':
          aVal = a.organization?.name || '';
          bVal = b.organization?.name || '';
          break;
        case 'institution_type':
          aVal = a.institution_type || '';
          bVal = b.institution_type || '';
          break;
        case 'enrollment_fte':
          aVal = a.enrollment_fte;
          bVal = b.enrollment_fte;
          break;
        case 'total_square_footage':
          aVal = a.total_square_footage;
          bVal = b.total_square_footage;
          break;
        case 'total_sales':
          aVal = a.totalSales;
          bVal = b.totalSales;
          break;
        case 'online_sales':
          aVal = a.total_online_sales;
          bVal = b.total_online_sales;
          break;
        case 'net_profit':
          aVal = a.net_profit;
          bVal = b.net_profit;
          break;
        case 'sales_per_sqft':
          aVal = a.salesPerSqFt;
          bVal = b.salesPerSqFt;
          break;
        case 'sales_per_student':
          aVal = a.salesPerStudent;
          bVal = b.salesPerStudent;
          break;
        case 'profit_margin':
          aVal = a.profitMargin;
          bVal = b.profitMargin;
          break;
      }

      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      // Compare
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [allBenchmarking, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-gray-400">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <ProtectedSection requiredPermission="survey_participant">
      <div className="space-y-4">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Survey Participants Comparison
          </h3>
          <p className="text-xs text-gray-400">
            {sortedData.length} institutions · Click any row to view full details · Click headers to sort
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr>
                <SortHeader field="name">Institution</SortHeader>
                <SortHeader field="institution_type">Type</SortHeader>
                <SortHeader field="enrollment_fte">Enrollment</SortHeader>
                <SortHeader field="total_square_footage">Sq Ft</SortHeader>
                <SortHeader field="total_sales">Total Sales</SortHeader>
                <SortHeader field="online_sales">Online</SortHeader>
                <SortHeader field="net_profit">Net Profit</SortHeader>
                <SortHeader field="sales_per_sqft">$/Sq Ft</SortHeader>
                <SortHeader field="sales_per_student">$/Student</SortHeader>
                <SortHeader field="profit_margin">Margin</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => {
                const isCurrentOrg = row.organization_id === currentOrgId;
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-gray-50 transition-colors ${
                      isCurrentOrg ? 'bg-blue-50 hover:bg-blue-100' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <BlurredValue placeholderWidth={16}>
                        <Link
                          href={`/org/${row.organization?.slug}`}
                          className={`hover:underline ${isCurrentOrg ? 'font-semibold text-[#D92327]' : 'text-[#1A1A1A]'}`}
                        >
                          {row.organization?.name || 'Unknown'}
                          {isCurrentOrg && <span className="ml-2 text-xs text-blue-500">(You)</span>}
                        </Link>
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      <BlurredValue placeholderWidth={4}>
                        {formatInstitutionType(row.institution_type)}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <BlurredValue placeholderWidth={6}>
                        {row.enrollment_fte?.toLocaleString() || '—'}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <BlurredValue placeholderWidth={6}>
                        {row.total_square_footage?.toLocaleString() || '—'}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-medium">
                      <BlurredValue placeholderWidth={8}>
                        {formatCurrency(row.totalSales)}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <BlurredValue placeholderWidth={6}>
                        {formatCurrency(row.total_online_sales)}
                      </BlurredValue>
                    </td>
                    <td className={`px-3 py-2 font-medium ${
                      row.net_profit !== null && row.net_profit < 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      <BlurredValue placeholderWidth={7}>
                        {formatCurrency(row.net_profit)}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <BlurredValue placeholderWidth={5}>
                        {row.salesPerSqFt ? `$${Math.round(row.salesPerSqFt)}` : '—'}
                      </BlurredValue>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <BlurredValue placeholderWidth={6}>
                        {row.salesPerStudent ? `$${row.salesPerStudent.toFixed(2)}` : '—'}
                      </BlurredValue>
                    </td>
                    <td className={`px-3 py-2 font-medium ${
                      row.profitMargin !== null && row.profitMargin < 0 ? 'text-red-600' : 'text-gray-700'
                    }`}>
                      <BlurredValue placeholderWidth={5}>
                        {row.profitMargin !== null ? `${row.profitMargin.toFixed(1)}%` : '—'}
                      </BlurredValue>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ProtectedSection>
  );
}

function formatInstitutionType(type: string | null): string {
  if (!type) return '—';
  switch (type) {
    case 'University': return 'Univ';
    case 'College': return 'Coll';
    case 'Polytechnic': return 'Poly';
    default: return type.slice(0, 4);
  }
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  const absValue = Math.abs(value);
  const prefix = value < 0 ? '-' : '';

  if (absValue >= 1000000) {
    return `${prefix}$${(absValue / 1000000).toFixed(1)}M`;
  }
  if (absValue >= 1000) {
    return `${prefix}$${(absValue / 1000).toFixed(0)}K`;
  }
  return `${prefix}$${absValue.toLocaleString()}`;
}
