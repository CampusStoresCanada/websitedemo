"use client";

import {
  SectionHeading,
  TextField,
  SelectField,
  type SurveySectionProps,
} from "../SurveyFields";

const SOCIAL_FREQUENCY = [
  { value: "Daily", label: "Daily" },
  { value: "Several times a week", label: "Several times a week" },
  { value: "Weekly", label: "Weekly" },
  { value: "Monthly", label: "Monthly" },
  { value: "Rarely", label: "Rarely" },
  { value: "Never", label: "Never" },
];

const SOCIAL_RUN_BY = [
  { value: "In-house", label: "In-house" },
  { value: "Outsourced", label: "Outsourced" },
  { value: "Mix", label: "Mix of in-house and outsourced" },
  { value: "N/A", label: "N/A" },
];

export default function SurveySection7(props: SurveySectionProps) {
  return (
    <div>
      <SectionHeading
        title="7. Technology & Systems"
        description="Tell us about your store's technology stack and operational platforms."
      />

      <TextField
        label="POS System"
        field="pos_system"
        formData={props.formData}
        onFieldChange={props.onFieldChange}
        isReadOnly={props.isReadOnly}
        placeholder="e.g., MBS, Bookware, Ratex, Square"
      />

      <TextField
        label="eBook Delivery System"
        field="ebook_delivery_system"
        formData={props.formData}
        onFieldChange={props.onFieldChange}
        isReadOnly={props.isReadOnly}
        placeholder="e.g., VitalSource, RedShelf, Direct from publisher"
      />

      <div className="grid md:grid-cols-2 gap-x-6">
        <TextField
          label="Student Information System"
          field="student_info_system"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Banner, PeopleSoft"
        />
        <TextField
          label="LMS (Learning Management System)"
          field="lms_system"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Blackboard, Canvas, Moodle, D2L"
        />
      </div>

      <TextField
        label="Payment Options"
        field="payment_options"
        formData={props.formData}
        onFieldChange={props.onFieldChange}
        isReadOnly={props.isReadOnly}
        placeholder="e.g., Cash, Credit, Debit, Student Account, Campus Card"
        helpText="List all payment methods accepted, separated by commas"
      />

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Social Media & Marketing
        </h3>

        <TextField
          label="Social Media Platforms"
          field="social_media_platforms"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Instagram, TikTok, Facebook, X/Twitter"
          helpText="List all platforms, separated by commas"
        />

        <div className="grid md:grid-cols-2 gap-x-6">
          <SelectField
            label="Posting Frequency"
            field="social_media_frequency"
            options={SOCIAL_FREQUENCY}
            formData={props.formData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
          />
          <SelectField
            label="Social Media Managed By"
            field="social_media_run_by"
            options={SOCIAL_RUN_BY}
            formData={props.formData}
            onFieldChange={props.onFieldChange}
            isReadOnly={props.isReadOnly}
          />
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6 mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Services & Operations
        </h3>

        <TextField
          label="Services Offered"
          field="services_offered"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Grad Photos, Print/Copy, Engraving, Regalia"
          helpText="List services offered, separated by commas"
        />

        <TextField
          label="Shopping Services"
          field="shopping_services"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Curbside Pickup, Same-day Delivery, Ship to Home"
        />

        <TextField
          label="Store-in-Stores"
          field="store_in_stores"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Spirit Shop, Tech Hub, Starbucks"
        />

        <TextField
          label="Physical Inventory Schedule"
          field="physical_inventory_schedule"
          formData={props.formData}
          onFieldChange={props.onFieldChange}
          isReadOnly={props.isReadOnly}
          placeholder="e.g., Annual, Bi-annual, Cycle counts"
        />
      </div>
    </div>
  );
}
