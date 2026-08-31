"use client";

import type { Benchmarking } from "@/lib/types/db";
import { ProtectedSection, BlurredValue } from "@/components/ui/GreyBlur";
import { fieldProps, type EditableColumn } from "@/lib/editable-fields";
import type { ManualEditMark } from "@/lib/benchmarking/manual-edit";

type BenchmarkingField = EditableColumn<"benchmarking">;

interface BenchmarkingDetailsProps {
  benchmarking: Benchmarking;
  organizationName: string;
  /** Toolkit edit mode is on and this viewer administers this store. */
  editable?: boolean;
  organizationId?: string;
  /** Figures corrected outside the survey, keyed by column. */
  manualEdits?: Record<string, ManualEditMark>;
  /** This year's package has gone out, so the comparison keeps the published
   *  figure even after a correction here. */
  yearIsPublished?: boolean;
}

export default function BenchmarkingDetails({
  benchmarking,
  organizationName,
  editable = false,
  organizationId,
  manualEdits = {},
  yearIsPublished = false,
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

  // One place to build the editable-field attributes, so every row passes the
  // stored number as data-raw-value. The rendered text is abbreviated
  // ("$1.2M"), and seeding the editor from that would round the figure the
  // moment anyone opened it.
  const edit = (column: BenchmarkingField, rawValue: number | string | null) =>
    editable && organizationId
      ? fieldProps("benchmarking", column, benchmarking.id, organizationId, rawValue)
      : undefined;

  const amendedCount = Object.keys(manualEdits).length;

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

        {editable && <EditNotice yearIsPublished={yearIsPublished} />}

        {amendedCount > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {amendedCount === 1 ? "One figure has" : `${amendedCount} figures have`}{" "}
            been corrected since this survey was filed. Corrected figures are
            marked below.
          </p>
        )}

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
            editProps={edit("net_profit", benchmarking.net_profit)}
            mark={manualEdits.net_profit}
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
            <DataRow label="In-Store Sales" value={formatCurrency(benchmarking.total_gross_sales_instore)} editProps={edit("total_gross_sales_instore", benchmarking.total_gross_sales_instore)} mark={manualEdits.total_gross_sales_instore} />
            <DataRow label="Online Sales" value={formatCurrency(benchmarking.total_online_sales)} editProps={edit("total_online_sales", benchmarking.total_online_sales)} mark={manualEdits.total_online_sales} />
            <DataRow label="Course Supplies" value={formatCurrency(benchmarking.sales_course_supplies)} editProps={edit("sales_course_supplies", benchmarking.sales_course_supplies)} mark={manualEdits.sales_course_supplies} />
            <DataRow label="Course Supplies (Online)" value={formatCurrency(benchmarking.sales_course_supplies_online)} editProps={edit("sales_course_supplies_online", benchmarking.sales_course_supplies_online)} mark={manualEdits.sales_course_supplies_online} />
            <DataRow label="General Books" value={formatCurrency(benchmarking.sales_general_books)} editProps={edit("sales_general_books", benchmarking.sales_general_books)} mark={manualEdits.sales_general_books} />
            <DataRow label="Technology" value={formatCurrency(benchmarking.sales_technology)} editProps={edit("sales_technology", benchmarking.sales_technology)} mark={manualEdits.sales_technology} />
            <DataRow label="Stationery" value={formatCurrency(benchmarking.sales_stationary)} editProps={edit("sales_stationary", benchmarking.sales_stationary)} mark={manualEdits.sales_stationary} />
            <DataRow label="Custom Merch" value={formatCurrency(benchmarking.sales_custom_merch)} editProps={edit("sales_custom_merch", benchmarking.sales_custom_merch)} mark={manualEdits.sales_custom_merch} />
            <DataRow label="Food & Beverage" value={formatCurrency(benchmarking.sales_food_beverage)} editProps={edit("sales_food_beverage", benchmarking.sales_food_beverage)} mark={manualEdits.sales_food_beverage} />
          </div>
        </div>

        {/* Expenses */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Expenses & Financials
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Cost of Goods Sold" value={formatCurrency(benchmarking.total_cogs)} editProps={edit("total_cogs", benchmarking.total_cogs)} mark={manualEdits.total_cogs} />
            <DataRow label="HR Expense" value={formatCurrency(benchmarking.expense_hr)} editProps={edit("expense_hr", benchmarking.expense_hr)} mark={manualEdits.expense_hr} />
            <DataRow label="Rent & Maintenance" value={formatCurrency(benchmarking.expense_rent_maintenance)} editProps={edit("expense_rent_maintenance", benchmarking.expense_rent_maintenance)} mark={manualEdits.expense_rent_maintenance} />
            <DataRow label="Marketing Spend" value={formatCurrency(benchmarking.marketing_spend)} editProps={edit("marketing_spend", benchmarking.marketing_spend)} mark={manualEdits.marketing_spend} />
            <DataRow label="Central Funding" value={formatCurrency(benchmarking.central_funding)} editProps={edit("central_funding", benchmarking.central_funding)} mark={manualEdits.central_funding} />
          </div>
        </div>

        {/* Staffing */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Staffing & Operations
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Full-Time Employees" value={benchmarking.fulltime_employees?.toString()} editProps={edit("fulltime_employees", benchmarking.fulltime_employees)} mark={manualEdits.fulltime_employees} />
            <DataRow label="Part-Time FTE (Off-Peak)" value={benchmarking.parttime_fte_offpeak?.toString()} editProps={edit("parttime_fte_offpeak", benchmarking.parttime_fte_offpeak)} mark={manualEdits.parttime_fte_offpeak} />
            <DataRow label="Student FTE (Avg)" value={benchmarking.student_fte_average?.toString()} editProps={edit("student_fte_average", benchmarking.student_fte_average)} mark={manualEdits.student_fte_average} />
            <DataRow label="Total FTE" value={totalFTE.toFixed(1)} />
            <DataRow label="Sales per FTE" value={salesPerFTE ? formatCurrency(salesPerFTE) : 'N/A'} />
            <DataRow label="Manager Years (Current)" value={benchmarking.manager_years_current_position?.toString()} editProps={edit("manager_years_current_position", benchmarking.manager_years_current_position)} mark={manualEdits.manager_years_current_position} />
            <DataRow label="Manager Years (Industry)" value={benchmarking.manager_years_in_industry?.toString()} editProps={edit("manager_years_in_industry", benchmarking.manager_years_in_industry)} mark={manualEdits.manager_years_in_industry} />
          </div>
        </div>

        {/* Store Info */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Store Details
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <DataRow label="Institution Type" value={benchmarking.institution_type} editProps={edit("institution_type", benchmarking.institution_type)} mark={manualEdits.institution_type} />
            <DataRow label="Enrollment FTE" value={benchmarking.enrollment_fte?.toLocaleString()} editProps={edit("enrollment_fte", benchmarking.enrollment_fte)} mark={manualEdits.enrollment_fte} />
            <DataRow label="Square Footage" value={benchmarking.total_square_footage?.toLocaleString()} editProps={edit("total_square_footage", benchmarking.total_square_footage)} mark={manualEdits.total_square_footage} />
          </div>
        </div>
      </div>
    </ProtectedSection>
  );
}

/**
 * What editing here means, said before anyone does it.
 *
 * The survey is the instrument of record; this is the correction path for the
 * rest of the year. Both consequences are stated up front rather than
 * discovered — that the change is marked as a correction, and, for a year whose
 * package has already gone out, that the comparison keeps the published figure.
 */
function EditNotice({ yearIsPublished }: { yearIsPublished: boolean }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <p className="font-medium mb-1">Correcting a figure</p>
      <p className="text-blue-800">
        Click any figure to change it. Because this is outside the survey, the
        change is recorded as a correction — who made it, when, and what it was
        before — rather than as part of your original submission.
      </p>
      {yearIsPublished && (
        <p className="text-blue-800 mt-2">
          This year&rsquo;s results have already gone out to members, so the
          comparison charts keep the published figure. Correct it here and CSC
          can decide whether the year should be restated.
        </p>
      )}
    </div>
  );
}

/** Small marker on a figure that was changed after filing. */
function AmendedMark({ mark }: { mark: ManualEditMark }) {
  const was =
    mark.previousValue === null || mark.previousValue === ""
      ? "blank"
      : String(mark.previousValue);

  return (
    <span
      className="ml-1.5 inline-flex items-center align-middle text-amber-600"
      title={`Corrected after filing — was ${was}${
        mark.changedByEmail ? ` (${mark.changedByEmail})` : ""
      }`}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
      </svg>
    </span>
  );
}

type EditProps = ReturnType<typeof fieldProps> | undefined;

function MetricCard({
  label,
  value,
  highlight,
  editProps,
  mark,
}: {
  label: string;
  value: string;
  highlight?: 'positive' | 'negative';
  editProps?: EditProps;
  mark?: ManualEditMark;
}) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
        {label}
        {mark && <AmendedMark mark={mark} />}
      </div>
      <div className={`text-xl font-semibold ${
        highlight === 'negative' ? 'text-red-600' :
        highlight === 'positive' ? 'text-green-600' :
        'text-[#1A1A1A]'
      }`}>
        <BlurredValue placeholderWidth={10}>
          <span {...editProps}>{value}</span>
        </BlurredValue>
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  editProps,
  mark,
}: {
  label: string;
  value: string | null | undefined;
  editProps?: EditProps;
  mark?: ManualEditMark;
}) {
  return (
    <>
      <span className="text-gray-500">
        {label}
        {mark && <AmendedMark mark={mark} />}
      </span>
      <span className="text-[#1A1A1A] font-medium">
        <BlurredValue placeholderWidth={8}>
          <span {...editProps}>{value || '—'}</span>
        </BlurredValue>
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
