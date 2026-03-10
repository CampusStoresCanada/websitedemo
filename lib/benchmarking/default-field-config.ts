// ─────────────────────────────────────────────────────────────────
// Survey Field Configuration Types + Default Config
// ─────────────────────────────────────────────────────────────────

export type FieldType =
  | "currency"
  | "number"
  | "integer"
  | "percentage"
  | "text"
  | "text_long"
  | "select"
  | "boolean";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  order: number;
  visible: boolean;
  required?: boolean;
  tooltip?: string;
  helpText?: string;
  placeholder?: string;
  suffix?: string;
  options?: string[];
  /** Visual group heading this field belongs to */
  group?: string;
  /** Indent level: true = 1 level, or a number for deeper nesting */
  indent?: boolean | number;
  /** Conditional visibility — hide unless another field has a specific value */
  showIf?: { field: string; value: unknown };
  /** Calculated field config — not editable, displayed as computed value */
  calculated?: {
    formula: string;
    format: "currency" | "number" | "percentage";
  };
  /** Inline validation warnings */
  warnings?: Array<{
    condition: string;
    message: string;
  }>;
  /** Display-only field (e.g., institution name from org record) */
  displayOnly?: boolean;
  /** Section note that appears below the field */
  note?: string;
}

export interface SectionConfig {
  id: string;
  title: string;
  description?: string;
  order: number;
  fields: FieldConfig[];
}

export interface SurveyFieldConfig {
  sections: SectionConfig[];
}

// ─────────────────────────────────────────────────────────────────
// Compatible Type Changes
// ─────────────────────────────────────────────────────────────────

const TEXT_TYPES: FieldType[] = ["text", "text_long", "select"];
const NUMBER_TYPES: FieldType[] = ["number", "integer", "currency", "percentage"];
const BOOLEAN_TYPES: FieldType[] = ["boolean"];

export function getCompatibleTypes(currentType: FieldType): FieldType[] {
  if (TEXT_TYPES.includes(currentType)) return TEXT_TYPES;
  if (NUMBER_TYPES.includes(currentType)) return NUMBER_TYPES;
  if (BOOLEAN_TYPES.includes(currentType)) return BOOLEAN_TYPES;
  return [currentType];
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function getFieldConfig(survey: {
  field_config?: unknown;
}): SurveyFieldConfig {
  if (survey.field_config && typeof survey.field_config === "object") {
    return survey.field_config as SurveyFieldConfig;
  }
  return DEFAULT_FIELD_CONFIG;
}

// ─────────────────────────────────────────────────────────────────
// DEFAULT_FIELD_CONFIG
// Captures exactly the current hardcoded survey structure.
// When benchmarking_surveys.field_config is NULL, this is used.
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_FIELD_CONFIG: SurveyFieldConfig = {
  sections: [
    // ═══════════════════════════════════════════════════════════
    // Section 1: Institution Profile
    // ═══════════════════════════════════════════════════════════
    {
      id: "institution_profile",
      title: "Institution Profile",
      order: 1,
      fields: [
        {
          name: "organization_name_display",
          label: "Institution Name",
          type: "text",
          order: 1,
          visible: true,
          displayOnly: true,
        },
        {
          name: "store_name",
          label: "Store Name",
          type: "text",
          order: 2,
          visible: true,
          placeholder: "e.g., Campus Bookstore, The Hawk Shop",
        },
        {
          name: "institution_type",
          label: "Institution Type",
          type: "select",
          order: 3,
          visible: true,
          required: true,
          options: ["University", "College", "Polytechnic", "CEGEP"],
        },
        {
          name: "province_display",
          label: "Province",
          type: "select",
          order: 4,
          visible: true,
          displayOnly: true,
          helpText: "Derived from your organization record",
          options: [
            "Alberta",
            "British Columbia",
            "Manitoba",
            "New Brunswick",
            "Newfoundland and Labrador",
            "Nova Scotia",
            "Ontario",
            "Prince Edward Island",
            "Quebec",
            "Saskatchewan",
          ],
        },
        {
          name: "enrollment_fte",
          label: "FTE Enrolment",
          type: "number",
          order: 5,
          visible: true,
          required: true,
        },
        {
          name: "num_store_locations",
          label: "Number of Store Locations",
          type: "number",
          order: 6,
          visible: true,
        },
        {
          name: "total_square_footage",
          label: "Total Store Space",
          type: "number",
          order: 7,
          visible: true,
          suffix: "sq ft",
        },
        {
          name: "operations_mandate",
          label: "Operating Mandate",
          type: "select",
          order: 8,
          visible: true,
          options: ["Cost Recovery", "For-profit", "Not-for-profit"],
        },
        {
          name: "is_semester_based",
          label: "Semester-Based Institution?",
          type: "boolean",
          order: 9,
          visible: true,
        },
        {
          name: "fiscal_year_end_date",
          label: "Fiscal Year End Date",
          type: "text",
          order: 10,
          visible: true,
          placeholder: "MM/DD (e.g., 03/31)",
          helpText: "Month and day your fiscal year ends",
        },
        // Square Footage Breakdown group
        {
          name: "sqft_salesfloor",
          label: "Sales Floor",
          type: "number",
          order: 11,
          visible: true,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
        {
          name: "sqft_storage",
          label: "Storage",
          type: "number",
          order: 12,
          visible: true,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
        {
          name: "sqft_office",
          label: "Office",
          type: "number",
          order: 13,
          visible: true,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
        {
          name: "sqft_other",
          label: "Other",
          type: "number",
          order: 14,
          visible: true,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 2: Sales Revenue
    // ═══════════════════════════════════════════════════════════
    {
      id: "sales_revenue",
      title: "Sales Revenue",
      order: 2,
      fields: [
        {
          name: "total_gross_sales_instore",
          label: "In-Store Retail Sales",
          type: "currency",
          order: 1,
          visible: true,
          required: true,
        },
        {
          name: "total_online_sales",
          label: "Online Retail Sales",
          type: "currency",
          order: 2,
          visible: true,
          required: true,
        },
        {
          name: "_calc_total_retail",
          label: "Total Retail Revenue",
          type: "currency",
          order: 3,
          visible: true,
          calculated: {
            formula: "total_retail_revenue",
            format: "currency",
          },
        },
        // Non-Retail Revenue group
        {
          name: "ia_revenue",
          label: "Inclusive Access / Courseware-as-Fee Revenue",
          type: "currency",
          order: 4,
          visible: true,
          helpText:
            "Revenue from IA or equitable access programs that bypasses the retail channel",
          group: "Non-Retail Revenue",
          indent: true,
        },
        {
          name: "other_non_retail_revenue",
          label: "Other Non-Retail Revenue",
          type: "currency",
          order: 5,
          visible: true,
          helpText:
            "Central funding, grants, or other revenue not from retail sales",
          group: "Non-Retail Revenue",
          indent: true,
        },
        {
          name: "other_non_retail_description",
          label: "Description of Other Non-Retail Revenue",
          type: "text",
          order: 6,
          visible: true,
          placeholder: "Describe the source(s) of non-retail revenue",
          group: "Non-Retail Revenue",
          indent: true,
        },
        // Calculated totals
        {
          name: "_calc_total_revenue",
          label: "Total Revenue",
          type: "currency",
          order: 7,
          visible: true,
          calculated: {
            formula: "total_revenue",
            format: "currency",
          },
          group: "Calculated Totals",
          indent: true,
        },
        {
          name: "_calc_online_pct",
          label: "Online %",
          type: "percentage",
          order: 8,
          visible: true,
          calculated: {
            formula: "online_percentage",
            format: "percentage",
          },
          group: "Calculated Totals",
          indent: true,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 3: Financial Metrics
    // ═══════════════════════════════════════════════════════════
    {
      id: "financial_metrics",
      title: "Financial Metrics",
      order: 3,
      fields: [
        {
          name: "total_cogs",
          label: "Cost of Goods Sold (COGS)",
          type: "currency",
          order: 1,
          visible: true,
          required: true,
        },
        {
          name: "expense_hr",
          label: "HR Expense (Salaries, Wages, Benefits)",
          type: "currency",
          order: 2,
          visible: true,
          required: true,
        },
        {
          name: "expense_rent_maintenance",
          label: "Rent & Occupancy",
          type: "currency",
          order: 3,
          visible: true,
        },
        {
          name: "net_profit",
          label: "Net Profit / (Loss)",
          type: "currency",
          order: 4,
          visible: true,
          required: true,
          helpText: "Enter negative values for losses",
        },
        {
          name: "marketing_spend",
          label: "Marketing & Promotions",
          type: "currency",
          order: 5,
          visible: true,
        },
        {
          name: "central_funding",
          label: "Central Funding / Subsidy",
          type: "currency",
          order: 6,
          visible: true,
          helpText:
            "Funding received from the institution to support store operations",
        },
        // Calculated metrics
        {
          name: "_calc_gross_margin",
          label: "Gross Margin $",
          type: "currency",
          order: 7,
          visible: true,
          calculated: { formula: "gross_margin", format: "currency" },
          group: "Calculated Metrics",
          indent: true,
        },
        {
          name: "_calc_gross_margin_pct",
          label: "Gross Margin %",
          type: "percentage",
          order: 8,
          visible: true,
          calculated: { formula: "gross_margin_pct", format: "percentage" },
          group: "Calculated Metrics",
          indent: true,
          warnings: [
            {
              condition: "gross_margin_low",
              message: "Gross margin below 10% — please verify COGS.",
            },
            {
              condition: "gross_margin_high",
              message: "Gross margin above 60% — please verify COGS.",
            },
          ],
        },
        {
          name: "_calc_net_margin_pct",
          label: "Net Margin %",
          type: "percentage",
          order: 9,
          visible: true,
          calculated: { formula: "net_margin_pct", format: "percentage" },
          group: "Calculated Metrics",
          indent: true,
        },
        {
          name: "_calc_hr_pct",
          label: "HR % of Revenue",
          type: "percentage",
          order: 10,
          visible: true,
          calculated: { formula: "hr_pct_of_revenue", format: "percentage" },
          group: "Calculated Metrics",
          indent: true,
          warnings: [
            {
              condition: "hr_exceeds_revenue",
              message: "HR expense exceeds total revenue.",
            },
          ],
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 4: Staffing
    // ═══════════════════════════════════════════════════════════
    {
      id: "staffing",
      title: "Staffing",
      order: 4,
      fields: [
        {
          name: "fulltime_employees",
          label: "Full-Time Employees",
          type: "number",
          order: 1,
          visible: true,
          required: true,
        },
        {
          name: "parttime_fte_offpeak",
          label: "Part-Time FTE (Off-Peak)",
          type: "number",
          order: 2,
          visible: true,
          helpText: "Part-time staff expressed as FTE during off-peak",
        },
        {
          name: "student_fte_average",
          label: "Student FTE (Average)",
          type: "number",
          order: 3,
          visible: true,
        },
        // Manager Experience group
        {
          name: "manager_years_current_position",
          label: "Years in Current Position",
          type: "number",
          order: 4,
          visible: true,
          suffix: "years",
          group: "Manager Experience",
          indent: true,
        },
        {
          name: "manager_years_in_industry",
          label: "Years in Industry",
          type: "number",
          order: 5,
          visible: true,
          suffix: "years",
          group: "Manager Experience",
          indent: true,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 5: Course Materials Breakdown
    // ═══════════════════════════════════════════════════════════
    {
      id: "course_materials",
      title: "Course Materials Breakdown",
      description:
        "Break down your course materials revenue by category. For each category, report Total Revenue and the Online Portion.",
      order: 5,
      fields: [
        {
          name: "cm_print_new_total",
          label: "Print — New (Total)",
          type: "currency",
          order: 1,
          visible: true,
          group: "Print — New",
        },
        {
          name: "cm_print_new_online",
          label: "Print — New (Online)",
          type: "currency",
          order: 2,
          visible: true,
          group: "Print — New",
        },
        {
          name: "cm_print_used_total",
          label: "Print — Used (Total)",
          type: "currency",
          order: 3,
          visible: true,
          group: "Print — Used",
        },
        {
          name: "cm_print_used_online",
          label: "Print — Used (Online)",
          type: "currency",
          order: 4,
          visible: true,
          group: "Print — Used",
        },
        {
          name: "cm_custom_courseware_total",
          label: "Custom Courseware (Total)",
          type: "currency",
          order: 5,
          visible: true,
          group: "Custom Courseware",
        },
        {
          name: "cm_custom_courseware_online",
          label: "Custom Courseware (Online)",
          type: "currency",
          order: 6,
          visible: true,
          group: "Custom Courseware",
        },
        {
          name: "cm_rentals_total",
          label: "Rentals (Total)",
          type: "currency",
          order: 7,
          visible: true,
          group: "Rentals",
        },
        {
          name: "cm_rentals_online",
          label: "Rentals (Online)",
          type: "currency",
          order: 8,
          visible: true,
          group: "Rentals",
        },
        {
          name: "cm_digital_total",
          label: "Digital / E-Content (Total)",
          type: "currency",
          order: 9,
          visible: true,
          group: "Digital / E-Content",
        },
        {
          name: "cm_digital_online",
          label: "Digital / E-Content (Online)",
          type: "currency",
          order: 10,
          visible: true,
          group: "Digital / E-Content",
        },
        {
          name: "cm_inclusive_access_total",
          label: "Inclusive Access (Total)",
          type: "currency",
          order: 11,
          visible: true,
          group: "Inclusive Access",
          note: "Captures retail-channel IA revenue. If your IA program generates non-retail revenue (e.g., courseware-as-fee), report that in Section 2.",
        },
        {
          name: "cm_inclusive_access_online",
          label: "Inclusive Access (Online)",
          type: "currency",
          order: 12,
          visible: true,
          group: "Inclusive Access",
        },
        {
          name: "cm_course_packs_total",
          label: "Course Packs (Total)",
          type: "currency",
          order: 13,
          visible: true,
          group: "Course Packs",
        },
        {
          name: "cm_course_packs_online",
          label: "Course Packs (Online)",
          type: "currency",
          order: 14,
          visible: true,
          group: "Course Packs",
        },
        {
          name: "cm_other_total",
          label: "Other (Total)",
          type: "currency",
          order: 15,
          visible: true,
          group: "Other",
        },
        {
          name: "cm_other_online",
          label: "Other (Online)",
          type: "currency",
          order: 16,
          visible: true,
          group: "Other",
        },
        // Calculated totals
        {
          name: "_calc_total_cm",
          label: "Total Course Materials Revenue",
          type: "currency",
          order: 17,
          visible: true,
          calculated: { formula: "total_course_materials", format: "currency" },
          group: "Totals",
        },
        {
          name: "_calc_total_cm_online",
          label: "Total Course Materials Online",
          type: "currency",
          order: 18,
          visible: true,
          calculated: {
            formula: "total_course_materials_online",
            format: "currency",
          },
          group: "Totals",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 6: General Merchandise
    // ═══════════════════════════════════════════════════════════
    {
      id: "general_merchandise",
      title: "General Merchandise",
      order: 6,
      fields: [
        {
          name: "sales_course_supplies",
          label: "Course-Required Supplies (Total)",
          type: "currency",
          order: 1,
          visible: true,
        },
        {
          name: "sales_course_supplies_online",
          label: "Course-Required Supplies (Online)",
          type: "currency",
          order: 2,
          visible: true,
        },
        // Product Categories group
        {
          name: "sales_general_books",
          label: "General / Trade Books",
          type: "currency",
          order: 3,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_technology",
          label: "Technology",
          type: "currency",
          order: 4,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_stationary",
          label: "Stationery",
          type: "currency",
          order: 5,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_apparel",
          label: "Apparel (Total)",
          type: "currency",
          order: 6,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_apparel_imprint",
          label: "Imprinted",
          type: "currency",
          order: 7,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_apparel_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          order: 8,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_gifts_drinkware",
          label: "Gifts & Drinkware (Total)",
          type: "currency",
          order: 9,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_gifts_imprint",
          label: "Imprinted",
          type: "currency",
          order: 10,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_gifts_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          order: 11,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_custom_merch",
          label: "Custom / Licensed Merchandise",
          type: "currency",
          order: 12,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_food_beverage",
          label: "Food & Beverage",
          type: "currency",
          order: 13,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 7: Technology & Systems
    // ═══════════════════════════════════════════════════════════
    {
      id: "technology_systems",
      title: "Technology & Systems",
      order: 7,
      fields: [
        {
          name: "pos_system",
          label: "POS System",
          type: "text",
          order: 1,
          visible: true,
          placeholder: "e.g., MBS, Bookware, Ratex, Square",
        },
        {
          name: "ebook_delivery_system",
          label: "eBook Delivery System",
          type: "text",
          order: 2,
          visible: true,
          placeholder: "e.g., VitalSource, RedShelf, Direct from publisher",
        },
        {
          name: "student_info_system",
          label: "Student Information System",
          type: "text",
          order: 3,
          visible: true,
          placeholder: "e.g., Banner, PeopleSoft",
        },
        {
          name: "lms_system",
          label: "LMS (Learning Management System)",
          type: "text",
          order: 4,
          visible: true,
          placeholder: "e.g., Blackboard, Canvas, Moodle, D2L",
        },
        {
          name: "payment_options",
          label: "Payment Options",
          type: "text",
          order: 5,
          visible: true,
          placeholder:
            "e.g., Cash, Credit, Debit, Student Account, Campus Card",
          helpText: "List all payment methods accepted, separated by commas",
        },
        // Social Media & Marketing group
        {
          name: "social_media_platforms",
          label: "Social Media Platforms",
          type: "text",
          order: 6,
          visible: true,
          placeholder: "e.g., Instagram, TikTok, Facebook, X/Twitter",
          helpText: "List all platforms, separated by commas",
          group: "Social Media & Marketing",
          indent: true,
        },
        {
          name: "social_media_frequency",
          label: "Posting Frequency",
          type: "select",
          order: 7,
          visible: true,
          options: [
            "Daily",
            "Several times a week",
            "Weekly",
            "Monthly",
            "Rarely",
            "Never",
          ],
          group: "Social Media & Marketing",
          indent: true,
        },
        {
          name: "social_media_run_by",
          label: "Social Media Managed By",
          type: "select",
          order: 8,
          visible: true,
          options: [
            "In-house",
            "Outsourced",
            "Mix of in-house and outsourced",
            "N/A",
          ],
          group: "Social Media & Marketing",
          indent: true,
        },
        // Services & Operations group
        {
          name: "services_offered",
          label: "Services Offered",
          type: "text",
          order: 9,
          visible: true,
          placeholder: "e.g., Grad Photos, Print/Copy, Engraving, Regalia",
          helpText: "List services offered, separated by commas",
          group: "Services & Operations",
          indent: true,
        },
        {
          name: "shopping_services",
          label: "Shopping Services",
          type: "text",
          order: 10,
          visible: true,
          placeholder:
            "e.g., Curbside Pickup, Same-day Delivery, Ship to Home",
          group: "Services & Operations",
          indent: true,
        },
        {
          name: "store_in_stores",
          label: "Store-in-Stores",
          type: "text",
          order: 11,
          visible: true,
          placeholder: "e.g., Spirit Shop, Tech Hub, Starbucks",
          group: "Services & Operations",
          indent: true,
        },
        {
          name: "physical_inventory_schedule",
          label: "Physical Inventory Schedule",
          type: "text",
          order: 12,
          visible: true,
          placeholder: "e.g., Annual, Bi-annual, Cycle counts",
          group: "Services & Operations",
          indent: true,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 8: Store Operations & New KPIs
    // ═══════════════════════════════════════════════════════════
    {
      id: "store_operations",
      title: "Store Operations & New KPIs",
      order: 8,
      fields: [
        // Store Hours group
        {
          name: "weekday_hours_open",
          label: "Weekday Open",
          type: "text",
          order: 1,
          visible: true,
          placeholder: "9:00 AM",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "weekday_hours_close",
          label: "Weekday Close",
          type: "text",
          order: 2,
          visible: true,
          placeholder: "5:00 PM",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "saturday_hours_open",
          label: "Saturday Open",
          type: "text",
          order: 3,
          visible: true,
          placeholder: "Closed",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "saturday_hours_close",
          label: "Saturday Close",
          type: "text",
          order: 4,
          visible: true,
          placeholder: "Closed",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "sunday_hours_open",
          label: "Sunday Open",
          type: "text",
          order: 5,
          visible: true,
          placeholder: "Closed",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "sunday_hours_close",
          label: "Sunday Close",
          type: "text",
          order: 6,
          visible: true,
          placeholder: "Closed",
          group: "Store Hours",
          indent: true,
        },
        {
          name: "hours_vary_seasonally",
          label: "Do your hours vary seasonally?",
          type: "boolean",
          order: 7,
          visible: true,
        },
        // Shrinkage group
        {
          name: "shrink_textbooks",
          label: "Textbooks Shrink %",
          type: "percentage",
          order: 8,
          visible: true,
          suffix: "%",
          group: "Shrinkage",
          indent: true,
        },
        {
          name: "shrink_general_merch",
          label: "General Merchandise Shrink %",
          type: "percentage",
          order: 9,
          visible: true,
          suffix: "%",
          group: "Shrinkage",
          indent: true,
        },
        // New KPI Fields group
        {
          name: "fye_inventory_value",
          label: "Fiscal Year-End Inventory Value (at cost)",
          type: "currency",
          order: 10,
          visible: true,
          helpText:
            "Inventory on hand at fiscal year-end, valued at cost. Used to calculate GMROI and inventory turns.",
          group: "New KPI Fields",
          indent: true,
          note: "These fields are new for FY2026. They help us build more granular benchmarks for inventory efficiency and adoption management.",
        },
        {
          name: "total_transaction_count",
          label: "Total Transaction Count",
          type: "integer",
          order: 11,
          visible: true,
          helpText:
            "Total number of sales transactions (in-store + online) for the year. Used to calculate average transaction value.",
          group: "New KPI Fields",
          indent: true,
        },
        {
          name: "tracks_adoptions",
          label: "Does your store track textbook adoptions?",
          type: "boolean",
          order: 12,
          visible: true,
          group: "New KPI Fields",
          indent: true,
        },
        {
          name: "total_course_sections",
          label: "Total Course Sections",
          type: "integer",
          order: 13,
          visible: true,
          helpText: "Total number of course sections at your institution",
          group: "New KPI Fields",
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
        },
        {
          name: "adoptions_by_deadline",
          label: "Adoptions Received by Deadline",
          type: "integer",
          order: 14,
          visible: true,
          helpText: "Number of adoptions received before your deadline",
          group: "New KPI Fields",
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
        },
        {
          name: "adoption_deadline_window",
          label: "Adoption Deadline Window",
          type: "select",
          order: 15,
          visible: true,
          options: [
            "2 weeks before term",
            "4 weeks before term",
            "6 weeks before term",
            "8+ weeks before term",
            "Other",
          ],
          group: "New KPI Fields",
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Calculated Field Formulas
// These are referenced by name in the config and evaluated at runtime.
// ─────────────────────────────────────────────────────────────────

export function evaluateFormula(
  formulaName: string,
  formData: Record<string, unknown>
): number | null {
  const num = (field: string): number =>
    typeof formData[field] === "number" ? (formData[field] as number) : 0;

  switch (formulaName) {
    case "total_retail_revenue":
      return num("total_gross_sales_instore") + num("total_online_sales");

    case "total_revenue":
      return (
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue")
      );

    case "online_percentage": {
      const totalRetail =
        num("total_gross_sales_instore") + num("total_online_sales");
      return totalRetail > 0
        ? (num("total_online_sales") / totalRetail) * 100
        : null;
    }

    case "gross_margin": {
      const totalRev =
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue");
      return totalRev - num("total_cogs");
    }

    case "gross_margin_pct": {
      const totalRev2 =
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue");
      return totalRev2 > 0
        ? ((totalRev2 - num("total_cogs")) / totalRev2) * 100
        : null;
    }

    case "net_margin_pct": {
      const totalRev3 =
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue");
      return totalRev3 > 0
        ? (num("net_profit") / totalRev3) * 100
        : null;
    }

    case "hr_pct_of_revenue": {
      const totalRev4 =
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue");
      return totalRev4 > 0
        ? (num("expense_hr") / totalRev4) * 100
        : null;
    }

    case "total_course_materials": {
      const cmTotalFields = [
        "cm_print_new_total",
        "cm_print_used_total",
        "cm_custom_courseware_total",
        "cm_rentals_total",
        "cm_digital_total",
        "cm_inclusive_access_total",
        "cm_course_packs_total",
        "cm_other_total",
      ];
      return cmTotalFields.reduce((sum, f) => sum + num(f), 0);
    }

    case "total_course_materials_online": {
      const cmOnlineFields = [
        "cm_print_new_online",
        "cm_print_used_online",
        "cm_custom_courseware_online",
        "cm_rentals_online",
        "cm_digital_online",
        "cm_inclusive_access_online",
        "cm_course_packs_online",
        "cm_other_online",
      ];
      return cmOnlineFields.reduce((sum, f) => sum + num(f), 0);
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Warning Condition Evaluation
// ─────────────────────────────────────────────────────────────────

export function evaluateWarning(
  conditionName: string,
  formData: Record<string, unknown>
): boolean {
  const totalRevenue = evaluateFormula("total_revenue", formData) ?? 0;
  const grossMarginPct = evaluateFormula("gross_margin_pct", formData);
  const expenseHr =
    typeof formData.expense_hr === "number"
      ? (formData.expense_hr as number)
      : 0;

  switch (conditionName) {
    case "gross_margin_low":
      return grossMarginPct !== null && grossMarginPct < 10 && totalRevenue > 0;
    case "gross_margin_high":
      return grossMarginPct !== null && grossMarginPct > 60;
    case "hr_exceeds_revenue":
      return expenseHr > totalRevenue && totalRevenue > 0;
    default:
      return false;
  }
}
