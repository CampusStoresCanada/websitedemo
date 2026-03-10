"use client";

import {
  SectionHeading,
  CurrencyField,
  CalculatedField,
  type SurveySectionProps,
} from "../SurveyFields";

const CM_CATEGORIES = [
  { label: "Print — New", totalField: "cm_print_new_total", onlineField: "cm_print_new_online" },
  { label: "Print — Used", totalField: "cm_print_used_total", onlineField: "cm_print_used_online" },
  { label: "Custom Courseware", totalField: "cm_custom_courseware_total", onlineField: "cm_custom_courseware_online" },
  { label: "Rentals", totalField: "cm_rentals_total", onlineField: "cm_rentals_online" },
  { label: "Digital / E-Content", totalField: "cm_digital_total", onlineField: "cm_digital_online" },
  { label: "Inclusive Access", totalField: "cm_inclusive_access_total", onlineField: "cm_inclusive_access_online" },
  { label: "Course Packs", totalField: "cm_course_packs_total", onlineField: "cm_course_packs_online" },
  { label: "Other", totalField: "cm_other_total", onlineField: "cm_other_online" },
];

export default function SurveySection5(props: SurveySectionProps) {
  // Calculate totals
  let totalCM = 0;
  let totalCMOnline = 0;

  CM_CATEGORIES.forEach((cat) => {
    totalCM += Number(props.formData[cat.totalField]) || 0;
    totalCMOnline += Number(props.formData[cat.onlineField]) || 0;
  });

  return (
    <div>
      <SectionHeading
        title="5. Course Materials Breakdown"
        description="Break down your total course materials revenue by format. Report both the total and the online portion for each category."
      />

      {/* Header row */}
      <div className="hidden md:grid md:grid-cols-[1fr_1fr_1fr] gap-x-4 mb-2 px-1">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Revenue</div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Online Portion</div>
      </div>

      {CM_CATEGORIES.map((cat) => (
        <div key={cat.totalField} className="grid md:grid-cols-[1fr_1fr_1fr] gap-x-4 items-start border-b border-gray-100 pb-2 mb-2">
          <div className="text-sm font-medium text-gray-700 pt-2 md:pt-2">
            {cat.label}
          </div>
          <CurrencyField
            label=""
            field={cat.totalField}
            {...props}
          />
          <CurrencyField
            label=""
            field={cat.onlineField}
            {...props}
          />
        </div>
      ))}

      <div className="border-t border-gray-200 pt-4 mt-4">
        <div className="grid md:grid-cols-2 gap-x-6">
          <CalculatedField label="Total Course Materials Revenue" value={totalCM} />
          <CalculatedField label="Total Course Materials Online" value={totalCMOnline} />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Note: The Inclusive Access line here captures retail-channel IA revenue. If your IA program
          generates non-retail revenue (e.g., courseware-as-fee), report that in Section 2.
        </p>
      </div>
    </div>
  );
}
