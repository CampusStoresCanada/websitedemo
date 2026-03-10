"use client";

import {
  SectionHeading,
  TextField,
  NumberField,
  CurrencyField,
  BooleanField,
  SelectField,
  type SurveySectionProps,
} from "../SurveyFields";

const DEADLINE_WINDOWS = [
  { value: "2 weeks before term", label: "2 weeks before term" },
  { value: "4 weeks before term", label: "4 weeks before term" },
  { value: "6 weeks before term", label: "6 weeks before term" },
  { value: "8+ weeks before term", label: "8+ weeks before term" },
  { value: "Other", label: "Other" },
];

export default function SurveySection8(props: SurveySectionProps) {
  const tracksAdoptions = props.formData.tracks_adoptions === true;

  return (
    <div>
      <SectionHeading
        title="8. Store Operations & New KPIs"
        description="Store hours, inventory data, and adoption tracking metrics."
      />

      {/* Store Hours */}
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Store Hours</h3>
      <div className="grid md:grid-cols-3 gap-x-6">
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Weekday</p>
          <div className="grid grid-cols-2 gap-x-3">
            <TextField
              label="Open"
              field="weekday_hours_open"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="9:00 AM"
            />
            <TextField
              label="Close"
              field="weekday_hours_close"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="5:00 PM"
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Saturday</p>
          <div className="grid grid-cols-2 gap-x-3">
            <TextField
              label="Open"
              field="saturday_hours_open"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="Closed"
            />
            <TextField
              label="Close"
              field="saturday_hours_close"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="Closed"
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium">Sunday</p>
          <div className="grid grid-cols-2 gap-x-3">
            <TextField
              label="Open"
              field="sunday_hours_open"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="Closed"
            />
            <TextField
              label="Close"
              field="sunday_hours_close"
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              placeholder="Closed"
            />
          </div>
        </div>
      </div>

      <BooleanField
        label="Do your hours vary seasonally?"
        field="hours_vary_seasonally"
        formData={props.formData}
        onFieldChange={props.onFieldChange}
        isReadOnly={props.isReadOnly}
      />

      {/* Shrink */}
      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Shrinkage (%)
        </h3>
        <div className="grid md:grid-cols-2 gap-x-6">
          <NumberField
            label="Textbooks Shrink %"
            field="shrink_textbooks"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            step="0.01"
            suffix="%"
          />
          <NumberField
            label="General Merchandise Shrink %"
            field="shrink_general_merch"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            step="0.01"
            suffix="%"
          />
        </div>
      </div>

      {/* New KPIs */}
      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          New KPI Fields
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          These fields are new for FY2026. They help us build more granular benchmarks
          for inventory efficiency and adoption management.
        </p>

        <CurrencyField
          label="Fiscal Year-End Inventory Value (at cost)"
          field="fye_inventory_value"
          helpText="Inventory on hand at fiscal year-end, valued at cost. Used to calculate GMROI and inventory turns."
          {...props}
        />

        <NumberField
          label="Total Transaction Count"
          field="total_transaction_count"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          helpText="Total number of sales transactions (in-store + online) for the year. Used to calculate average transaction value."
        />

        <BooleanField
          label="Does your store track textbook adoptions?"
          field="tracks_adoptions"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
        />

        {tracksAdoptions && (
          <div className="ml-6 border-l-2 border-gray-200 pl-4 mt-2">
            <NumberField
              label="Total Course Sections"
              field="total_course_sections"
              formData={props.formData}
              priorYearData={props.priorYearData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              organizationName={props.organizationName}
              organizationProvince={props.organizationProvince}
              helpText="Total number of course sections at your institution"
            />
            <NumberField
              label="Adoptions Received by Deadline"
              field="adoptions_by_deadline"
              formData={props.formData}
              priorYearData={props.priorYearData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
              organizationName={props.organizationName}
              organizationProvince={props.organizationProvince}
              helpText="Number of adoptions received before your deadline"
            />
            <SelectField
              label="Adoption Deadline Window"
              field="adoption_deadline_window"
              options={DEADLINE_WINDOWS}
              formData={props.formData}
              onFieldChange={props.onFieldChange}
              isReadOnly={props.isReadOnly}
            />
          </div>
        )}
      </div>
    </div>
  );
}
