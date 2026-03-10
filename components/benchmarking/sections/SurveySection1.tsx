"use client";

import {
  SectionHeading,
  TextField,
  NumberField,
  SelectField,
  BooleanField,
  type SurveySectionProps,
} from "../SurveyFields";

const INSTITUTION_TYPES = [
  { value: "University", label: "University" },
  { value: "College", label: "College" },
  { value: "Polytechnic", label: "Polytechnic" },
  { value: "CEGEP", label: "CEGEP" },
];

const PROVINCES = [
  { value: "Alberta", label: "Alberta" },
  { value: "British Columbia", label: "British Columbia" },
  { value: "Manitoba", label: "Manitoba" },
  { value: "New Brunswick", label: "New Brunswick" },
  { value: "Newfoundland and Labrador", label: "Newfoundland and Labrador" },
  { value: "Nova Scotia", label: "Nova Scotia" },
  { value: "Ontario", label: "Ontario" },
  { value: "Prince Edward Island", label: "Prince Edward Island" },
  { value: "Quebec", label: "Quebec" },
  { value: "Saskatchewan", label: "Saskatchewan" },
];

const MANDATE_OPTIONS = [
  { value: "Cost Recovery", label: "Cost Recovery" },
  { value: "For-profit", label: "For-profit" },
  { value: "Not-for-profit", label: "Not-for-profit" },
];

export default function SurveySection1(props: SurveySectionProps) {
  return (
    <div>
      <SectionHeading
        title="1. Institution Profile"
        description="Basic information about your institution and campus store."
      />

      {/* Institution name - locked from org record */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Institution Name
        </label>
        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900">
          {props.organizationName}
        </div>
      </div>

      <TextField
        label="Store Name"
        field="store_name"
        formData={props.formData}
        onFieldChange={props.onFieldChange}
        isReadOnly={props.isReadOnly}
        placeholder="e.g., Campus Bookstore, The Hawk Shop"
      />

      <div className="grid md:grid-cols-2 gap-x-6">
        <SelectField
          label="Institution Type"
          field="institution_type"
          options={INSTITUTION_TYPES}
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          required
        />

        <SelectField
          label="Province"
          field="province_placeholder"
          options={PROVINCES}
          formData={{ ...props.formData, province_placeholder: props.organizationProvince }}
          onFieldChange={() => {}}
          isReadOnly={true}
          helpText="Derived from your organization record"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-x-6">
        <NumberField
          label="FTE Enrolment"
          field="enrollment_fte"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          required
        />

        <NumberField
          label="Number of Store Locations"
          field="num_store_locations"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-x-6">
        <NumberField
          label="Total Store Space"
          field="total_square_footage"
          formData={props.formData}
          priorYearData={props.priorYearData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          organizationName={props.organizationName}
          organizationProvince={props.organizationProvince}
          suffix="sq ft"
        />

        <SelectField
          label="Operating Mandate"
          field="operations_mandate"
          options={MANDATE_OPTIONS}
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-x-6">
        <BooleanField
          label="Semester-Based Institution?"
          field="is_semester_based"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
        />

        <TextField
          label="Fiscal Year End Date"
          field="fiscal_year_end_date"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="MM/DD (e.g., 03/31)"
          helpText="Month and day your fiscal year ends"
        />
      </div>

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Square Footage Breakdown
        </h3>
        <div className="grid md:grid-cols-4 gap-x-4">
          <NumberField
            label="Sales Floor"
            field="sqft_salesfloor"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="sq ft"
          />
          <NumberField
            label="Storage"
            field="sqft_storage"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="sq ft"
          />
          <NumberField
            label="Office"
            field="sqft_office"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="sq ft"
          />
          <NumberField
            label="Other"
            field="sqft_other"
            formData={props.formData}
            priorYearData={props.priorYearData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
            organizationName={props.organizationName}
            organizationProvince={props.organizationProvince}
            suffix="sq ft"
          />
        </div>
      </div>
    </div>
  );
}
