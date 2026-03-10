"use client";

import {
  SectionHeading,
  CurrencyField,
  CalculatedField,
  TextField,
  type SurveySectionProps,
} from "../SurveyFields";

export default function SurveySection2(props: SurveySectionProps) {
  const inStore = Number(props.formData.total_gross_sales_instore) || 0;
  const online = Number(props.formData.total_online_sales) || 0;
  const iaRevenue = Number(props.formData.ia_revenue) || 0;
  const otherNonRetail = Number(props.formData.other_non_retail_revenue) || 0;

  const totalRetail = inStore + online;
  const totalRevenue = totalRetail + iaRevenue + otherNonRetail;
  const onlinePct = totalRetail > 0 ? (online / totalRetail) * 100 : 0;

  return (
    <div>
      <SectionHeading
        title="2. Sales Revenue"
        description="Report all revenue figures for your fiscal year. Use whole dollar amounts."
      />

      <div className="grid md:grid-cols-2 gap-x-6">
        <CurrencyField
          label="In-Store Retail Sales"
          field="total_gross_sales_instore"
          required
          {...props}
        />
        <CurrencyField
          label="Online Retail Sales"
          field="total_online_sales"
          required
          {...props}
        />
      </div>

      <CalculatedField
        label="Total Retail Revenue"
        value={totalRetail}
      />

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Non-Retail Revenue
        </h3>

        <CurrencyField
          label="Inclusive Access / Courseware-as-Fee Revenue"
          field="ia_revenue"
          helpText="Revenue from IA or equitable access programs that bypasses the retail channel"
          {...props}
        />

        <CurrencyField
          label="Other Non-Retail Revenue"
          field="other_non_retail_revenue"
          helpText="Central funding, grants, or other revenue not from retail sales"
          {...props}
        />

        <TextField
          label="Description of Other Non-Retail Revenue"
          field="other_non_retail_description"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="Describe the source(s) of non-retail revenue"
        />
      </div>

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Calculated Totals
        </h3>
        <div className="grid md:grid-cols-3 gap-x-6">
          <CalculatedField
            label="Total Revenue"
            value={totalRevenue}
          />
          <CalculatedField
            label="Online %"
            value={onlinePct}
            format="percent"
          />
          <CalculatedField
            label="Central / Other Funding"
            value={Number(props.formData.central_funding) || null}
          />
        </div>
      </div>
    </div>
  );
}
