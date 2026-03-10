"use client";

import {
  SectionHeading,
  CurrencyField,
  CalculatedField,
  type SurveySectionProps,
} from "../SurveyFields";

export default function SurveySection3(props: SurveySectionProps) {
  const inStore = Number(props.formData.total_gross_sales_instore) || 0;
  const online = Number(props.formData.total_online_sales) || 0;
  const iaRevenue = Number(props.formData.ia_revenue) || 0;
  const otherNonRetail = Number(props.formData.other_non_retail_revenue) || 0;
  const totalRevenue = inStore + online + iaRevenue + otherNonRetail;

  const cogs = Number(props.formData.total_cogs) || 0;
  const netProfit = Number(props.formData.net_profit) || 0;
  const expenseHr = Number(props.formData.expense_hr) || 0;

  const grossMargin = totalRevenue - cogs;
  const grossMarginPct = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0;
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const hrPct = totalRevenue > 0 ? (expenseHr / totalRevenue) * 100 : 0;

  // Validation warnings
  const warnings: string[] = [];
  if (grossMarginPct < 10 && totalRevenue > 0) warnings.push("Gross margin below 10% — please verify COGS.");
  if (grossMarginPct > 60) warnings.push("Gross margin above 60% — please verify COGS.");
  if (expenseHr > totalRevenue && totalRevenue > 0) warnings.push("HR expense exceeds total revenue.");

  return (
    <div>
      <SectionHeading
        title="3. Financial Metrics"
        description="Report cost of goods, expenses, and net profit for your fiscal year."
      />

      <CurrencyField
        label="Cost of Goods Sold (COGS)"
        field="total_cogs"
        required
        {...props}
      />

      <div className="grid md:grid-cols-2 gap-x-6">
        <CurrencyField
          label="HR Expense (Salaries, Wages, Benefits)"
          field="expense_hr"
          required
          {...props}
        />
        <CurrencyField
          label="Rent & Occupancy"
          field="expense_rent_maintenance"
          {...props}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-x-6">
        <CurrencyField
          label="Net Profit / (Loss)"
          field="net_profit"
          required
          helpText="Enter negative values for losses"
          {...props}
        />
        <CurrencyField
          label="Marketing & Promotions"
          field="marketing_spend"
          {...props}
        />
      </div>

      <CurrencyField
        label="Central Funding / Subsidy"
        field="central_funding"
        helpText="Funding received from the institution to support store operations"
        {...props}
      />

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Calculated Metrics
        </h3>
        <div className="grid md:grid-cols-3 gap-x-6">
          <CalculatedField label="Gross Margin $" value={grossMargin} />
          <CalculatedField label="Gross Margin %" value={grossMarginPct} format="percent" />
          <CalculatedField label="Net Margin %" value={netMarginPct} format="percent" />
        </div>
        <div className="grid md:grid-cols-2 gap-x-6">
          <CalculatedField label="HR % of Revenue" value={hrPct} format="percent" />
        </div>
      </div>
    </div>
  );
}
