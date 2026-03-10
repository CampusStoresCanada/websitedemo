"use client";

import type { Benchmarking } from "@/lib/database.types";
import { ProtectedSection, BlurredValue } from "@/components/ui/GreyBlur";

interface BenchmarkingDetailsProps {
  benchmarking: Benchmarking;
  organizationName: string;
}

export default function BenchmarkingDetails({
  benchmarking,
  organizationName,
}: BenchmarkingDetailsProps) {
  // Calculate derived metrics
  const totalSales = (benchmarking.total_gross_sales_instore || 0) + (benchmarking.total_online_sales || 0);
  const salesPerSqFt = benchmarking.total_square_footage
    ? totalSales / benchmarking.total_square_footage
    : null;
  const profitMargin = totalSales > 0
    ? ((benchmarking.net_profit || 0) / totalSales) * 100
    : null;
  const totalFTE = (benchmarking.fulltime_employees || 0) +
    (benchmarking.parttime_fte_offpeak || 0) +
    (benchmarking.student_fte_average || 0);
  const salesPerFTE = totalFTE > 0 ? totalSales / totalFTE : null;

  return (
    <ProtectedSection requiredPermission="survey_participant">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-1">
            Benchmarking Data — FY{benchmarking.fiscal_year}
          </h2>
          <p className="text-sm text-gray-500">{organizationName}</p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Total Sales"
            value={formatCurrency(totalSales)}
          />
          <MetricCard
            label="Net Profit"
            value={formatCurrency(benchmarking.net_profit)}
            highlight={benchmarking.net_profit !== null && benchmarking.net_profit < 0 ? 'negative' : 'positive'}
          />
          <MetricCard
            label="Sales/Sq Ft"
            value={salesPerSqFt ? formatCurrency(salesPerSqFt) : 'N/A'}
          />
          <MetricCard
            label="Profit Margin"
            value={profitMargin !== null ? `${profitMargin.toFixed(1)}%` : 'N/A'}
            highlight={profitMargin !== null && profitMargin < 0 ? 'negative' : undefined}
          />
        </div>

        {/* Sales Breakdown */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Sales Breakdown
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="In-Store Sales" value={formatCurrency(benchmarking.total_gross_sales_instore)} />
            <DataRow label="Online Sales" value={formatCurrency(benchmarking.total_online_sales)} />
            <DataRow label="Course Supplies" value={formatCurrency(benchmarking.sales_course_supplies)} />
            <DataRow label="Course Supplies (Online)" value={formatCurrency(benchmarking.sales_course_supplies_online)} />
            <DataRow label="General Books" value={formatCurrency(benchmarking.sales_general_books)} />
            <DataRow label="Technology" value={formatCurrency(benchmarking.sales_technology)} />
            <DataRow label="Stationery" value={formatCurrency(benchmarking.sales_stationary)} />
            <DataRow label="Custom Merch" value={formatCurrency(benchmarking.sales_custom_merch)} />
            <DataRow label="Food & Beverage" value={formatCurrency(benchmarking.sales_food_beverage)} />
          </div>
        </div>

        {/* Expenses */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Expenses & Financials
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Cost of Goods Sold" value={formatCurrency(benchmarking.total_cogs)} />
            <DataRow label="HR Expense" value={formatCurrency(benchmarking.expense_hr)} />
            <DataRow label="Rent & Maintenance" value={formatCurrency(benchmarking.expense_rent_maintenance)} />
            <DataRow label="Marketing Spend" value={formatCurrency(benchmarking.marketing_spend)} />
            <DataRow label="Central Funding" value={formatCurrency(benchmarking.central_funding)} />
          </div>
        </div>

        {/* Staffing */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Staffing & Operations
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Full-Time Employees" value={benchmarking.fulltime_employees?.toString()} />
            <DataRow label="Part-Time FTE (Off-Peak)" value={benchmarking.parttime_fte_offpeak?.toString()} />
            <DataRow label="Student FTE (Avg)" value={benchmarking.student_fte_average?.toString()} />
            <DataRow label="Total FTE" value={totalFTE.toFixed(1)} />
            <DataRow label="Sales per FTE" value={salesPerFTE ? formatCurrency(salesPerFTE) : 'N/A'} />
            <DataRow label="Manager Years (Current)" value={benchmarking.manager_years_current_position?.toString()} />
            <DataRow label="Manager Years (Industry)" value={benchmarking.manager_years_in_industry?.toString()} />
          </div>
        </div>

        {/* Store Info */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Store Details
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Institution Type" value={benchmarking.institution_type} />
            <DataRow label="Enrollment FTE" value={benchmarking.enrollment_fte?.toLocaleString()} />
            <DataRow label="Square Footage" value={benchmarking.total_square_footage?.toLocaleString()} />
          </div>
        </div>
      </div>
    </ProtectedSection>
  );
}

function MetricCard({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: 'positive' | 'negative';
}) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-semibold ${
        highlight === 'negative' ? 'text-red-600' :
        highlight === 'positive' ? 'text-green-600' :
        'text-[#1A1A1A]'
      }`}>
        <BlurredValue placeholderWidth={10}>{value}</BlurredValue>
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="text-[#1A1A1A] font-medium">
        <BlurredValue placeholderWidth={8}>{value || '—'}</BlurredValue>
      </span>
    </>
  );
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
