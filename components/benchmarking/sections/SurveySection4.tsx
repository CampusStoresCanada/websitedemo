"use client";

import {
  SectionHeading,
  NumberField,
  type SurveySectionProps,
} from "../SurveyFields";

export default function SurveySection4(props: SurveySectionProps) {
  return (
    <div>
      <SectionHeading
        title="4. Staffing"
        description="Report staffing levels as FTE (full-time equivalent) values."
      />

      <div className="grid md:grid-cols-3 gap-x-6">
        <NumberField
          label="Full-Time Employees"
          field="fulltime_employees"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          step="0.1"
          required
        />
        <NumberField
          label="Part-Time FTE (Off-Peak)"
          field="parttime_fte_offpeak"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          step="0.1"
          helpText="Part-time staff expressed as FTE during off-peak"
        />
        <NumberField
          label="Student FTE (Average)"
          field="student_fte_average"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          step="0.1"
        />
      </div>

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Manager Experience
        </h3>
        <div className="grid md:grid-cols-2 gap-x-6">
          <NumberField
            label="Years in Current Position"
            field="manager_years_current_position"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="years"
          />
          <NumberField
            label="Years in Industry"
            field="manager_years_in_industry"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="years"
          />
        </div>
      </div>
    </div>
  );
}
