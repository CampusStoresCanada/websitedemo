"use client";

import { useState, useMemo } from "react";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import DynamicSurveySection from "@/components/benchmarking/DynamicSurveySection";

const SAMPLE_DATA: Record<string, unknown> = {
  // Section 1 — Institution Profile
  store_name: "Sample Campus Bookstore",
  institution_type: "University",
  enrollment_fte: 15000,
  num_store_locations: 2,
  total_square_footage: 12000,
  sqft_salesfloor: 7000,
  sqft_storage: 3000,
  sqft_office: 1500,
  sqft_other: 500,
  operations_mandate: "Not-for-profit",
  is_semester_based: true,
  fiscal_year_end_date: "03/31",

  // Section 2 — Sales Revenue
  total_gross_sales_instore: 4500000,
  total_online_sales: 1200000,
  ia_revenue: 350000,
  other_non_retail_revenue: 50000,
  other_non_retail_description: "Equipment rental and printing services",

  // Section 3 — Financial Metrics
  total_cogs: 3800000,
  expense_hr: 900000,
  expense_rent_maintenance: 180000,
  net_profit: 120000,
  marketing_spend: 45000,
  central_funding: 0,

  // Section 4 — Staffing
  fulltime_employees: 12,
  parttime_fte_offpeak: 8.5,
  student_fte_average: 6.0,
  manager_years_current_position: 5,
  manager_years_in_industry: 12,

  // Section 5 — Course Materials
  cm_print_new_total: 1800000,
  cm_print_new_online: 450000,
  cm_print_used_total: 320000,
  cm_print_used_online: 80000,
  cm_custom_courseware_total: 150000,
  cm_custom_courseware_online: 60000,
  cm_rentals_total: 200000,
  cm_rentals_online: 50000,
  cm_digital_total: 400000,
  cm_digital_online: 380000,
  cm_inclusive_access_total: 250000,
  cm_inclusive_access_online: 250000,
  cm_course_packs_total: 80000,
  cm_course_packs_online: 20000,
  cm_other_total: 30000,
  cm_other_online: 10000,

  // Section 6 — General Merchandise
  sales_course_supplies: 320000,
  sales_course_supplies_online: 80000,
  sales_general_books: 45000,
  sales_technology: 280000,
  sales_stationary: 60000,
  sales_apparel: 400000,
  sales_apparel_imprint: 350000,
  sales_apparel_non_imprint: 50000,
  sales_gifts_drinkware: 150000,
  sales_gifts_imprint: 120000,
  sales_gifts_non_imprint: 30000,
  sales_custom_merch: 90000,
  sales_food_beverage: 180000,

  // Section 7 — Technology & Systems
  pos_system: "Bookware",
  ebook_delivery_system: "VitalSource",
  student_info_system: "Banner",
  lms_system: "Brightspace",
  payment_options: "Credit, Debit, Cash, Student Card, Apple Pay",
  social_media_platforms: "Instagram, TikTok, Facebook",
  social_media_frequency: "Daily",
  social_media_run_by: "In-house",
  services_offered: "Grad Photos, Print/Copy, Regalia",
  shopping_services: "Curbside Pickup, Ship to Home",
  store_in_stores: "Spirit Shop",
  physical_inventory_schedule: "Annual",

  // Section 8 — Store Operations
  weekday_hours_open: "8:30 AM",
  weekday_hours_close: "5:00 PM",
  saturday_hours_open: "10:00 AM",
  saturday_hours_close: "4:00 PM",
  sunday_hours_open: "Closed",
  sunday_hours_close: "Closed",
  hours_vary_seasonally: true,
  shrink_textbooks: 1.2,
  shrink_general_merch: 2.5,
  fye_inventory_value: 850000,
  total_transaction_count: 95000,
  tracks_adoptions: true,
  total_course_sections: 3200,
  adoptions_by_deadline: 2400,
  adoption_deadline_window: "4 weeks before term",
};

interface SurveyPreviewProps {
  fieldConfig?: SurveyFieldConfig | null;
}

export default function SurveyPreview({ fieldConfig }: SurveyPreviewProps) {
  const config = useMemo(
    () => fieldConfig ?? DEFAULT_FIELD_CONFIG,
    [fieldConfig]
  );
  const sections = useMemo(
    () => [...config.sections].sort((a, b) => a.order - b.order),
    [config]
  );

  const [activeSection, setActiveSection] = useState(0);
  const [useSampleData, setUseSampleData] = useState(false);

  const formData = useSampleData ? SAMPLE_DATA : {};
  const noopFieldChange = () => {};
  const noopDeltaFlag = async () => {};

  const sectionProps = {
    formData,
    priorYearData: null,
    onFieldChange: noopFieldChange,
    onDeltaFlag: noopDeltaFlag,
    deltaFlags: [] as import("@/lib/database.types").DeltaFlag[],
    isReadOnly: false,
    organizationName: useSampleData ? "Sample Campus Bookstore" : "Your Organization",
    organizationProvince: "Ontario",
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {sections.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(idx)}
              className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeSection === idx
                  ? "bg-[#D60001] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.order}. {s.title}
            </button>
          ))}
        </div>

        <button
          onClick={() => setUseSampleData(!useSampleData)}
          className={`flex-shrink-0 ml-4 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            useSampleData
              ? "bg-blue-50 border-blue-200 text-blue-700"
              : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {useSampleData ? "Sample Data On" : "Fill Sample Data"}
        </button>
      </div>

      {/* Preview banner */}
      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-xs text-amber-700 font-medium">
          Preview Mode — Changes here are not saved. This shows what respondents see.
        </span>
      </div>

      {/* Section content */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {sections[activeSection] && (
          <DynamicSurveySection
            sectionConfig={sections[activeSection]}
            {...sectionProps}
          />
        )}
      </div>
    </div>
  );
}
