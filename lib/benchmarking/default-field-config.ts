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
  /**
   * Worked example from a practitioner — "here is what I actually put in this
   * box, and what it included." Authored by store directors, not by us: a
   * definition can be read two ways, a peer's example cannot.
   */
  example?: string;
  /** Store credited with the example, where they want the attribution. */
  exampleCredit?: string;
  /**
   * Reviewer-only context: what went wrong with this field in 2025, and what
   * we want a second pair of eyes on. Shown in the content-review tool and
   * NEVER rendered to a survey respondent — it would read as an accusation.
   */
  reviewerNote?: string;
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
const NUMBER_TYPES: FieldType[] = [
  "number",
  "integer",
  "currency",
  "percentage",
];
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
          helpText:
            "Taken from your CSC membership record. If it is wrong, tell us and we will correct it at the source.",
          order: 1,
          visible: true,
          displayOnly: true,
        },
        {
          name: "store_name",
          label: "Store Name",
          type: "text",
          helpText:
            "The name your store trades under, if it differs from the institution name.",
          order: 2,
          visible: true,
          placeholder: "e.g., Campus Bookstore, The Hawk Shop",
        },
        {
          name: "institution_type",
          label: "Institution Type",
          type: "select",
          helpText:
            "Use the classification your institution uses for itself. Polytechnic covers institutes of technology and polytechnics.",
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
          helpText:
            "Full-time-equivalent student enrolment for the current year, for the whole institution. Take it from your institutional fact book or registrar rather than estimating. This is the denominator for every per-student figure in your report.",
          reviewerNote:
            "Used as the denominator for every per-student figure in the report, so an error here distorts a lot. In 2025 it was unclear whether to give the whole institution or just the campus the store serves. Multi-campus stores especially — what would you enter?",
          order: 5,
          visible: true,
          required: true,
        },
        {
          name: "num_store_locations",
          label: "Number of Store Locations",
          type: "number",
          helpText:
            "Count every physical location you operate, including satellite and seasonal shops. Do not count your web store.",
          order: 6,
          visible: true,
        },
        {
          name: "total_square_footage",
          label: "Total Store Space",
          type: "number",
          helpText:
            "Retail floor space across all locations combined. If you break it down below, the parts should add up to this number.",
          reviewerNote:
            "In 2025 the parts did not always add up to the whole, and we could not tell whether storage and office were meant to be inside this number. Is it clear now?",
          order: 7,
          visible: true,
          suffix: "sq ft",
        },
        {
          name: "operations_mandate",
          label: "Operating Mandate",
          type: "select",
          helpText:
            "How your institution classifies the store's financial operating model. If you are expected to break even, choose Cost Recovery. If you are expected to return a surplus to the institution, choose For-profit.",
          reviewerNote:
            "Mandate was inconsistently categorised in 2025, which matters because it is one of the five dimensions we use to pick your peer group. Are these three options the right ones, and would you know without hesitating which one your store is?",
          order: 8,
          visible: true,
          options: ["Cost Recovery", "For-profit", "Not-for-profit"],
        },
        {
          name: "is_semester_based",
          label: "Semester-Based Institution?",
          type: "boolean",
          helpText:
            "Yes if your enrolment and sales follow distinct semesters with rush periods. No if you run continuous intake year-round.",
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
          helpText:
            "Space customers can walk in. Exclude stockrooms, offices and receiving.",
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
          helpText:
            "Stockrooms, receiving and any off-site storage you pay for.",
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
          helpText: "Staff offices and back-office workspace.",
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
          helpText:
            "Anything not covered above. Sales floor, storage, office and other should total your overall store space.",
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
          helpText:
            "Revenue from walk-in purchases at all physical locations, for the fiscal year. Do NOT include online sales, Inclusive Access, or any courseware billed as a student fee. If your reporting gives you one combined sales figure, split it here rather than entering the total in one box.",
          reviewerNote:
            "THE BIG ONE. In 2025 some stores put their whole sales figure here and others split it across this and Online, and nothing in the response told us which. Every institution had to be classified by hand, and where we guessed wrong the numbers were wrong. Does the wording now make it impossible to enter a combined total here?",
          order: 1,
          visible: true,
          required: true,
        },
        {
          name: "total_online_sales",
          label: "Online Retail Sales",
          type: "currency",
          helpText:
            "Revenue from your web store, for the fiscal year. Include every online order regardless of how it was fulfilled, including orders picked up in store. Do NOT include Inclusive Access or courseware billed as a student fee.",
          reviewerNote:
            "Other half of the 2025 sales-column problem. Also unclear in 2025 whether an online order collected in store counted as online or in-store — stores split both ways. Does the wording settle that?",
          order: 2,
          visible: true,
          required: true,
        },
        {
          name: "_calc_total_retail",
          label: "Total Retail Revenue",
          type: "currency",
          helpText: "In-store plus online. Calculated for you.",
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
            "Revenue from course materials bundled into student fees through the registrar or a similar institutional mechanism. This is not retail: it flows through course registration, not your till. Leave blank if you do not run an Inclusive Access or equitable access programme.",
          reviewerNote:
            "This field did not exist in 2025. One college runs a $16M Inclusive Access programme through registration fees; their figures looked broken until a phone call explained it, and we had to add a custom field and asterisk 39 packages. Is this description clear enough that an IA store knows this is where their money goes, and a non-IA store knows to leave it blank?",
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
            "Any other revenue that runs through the store's books but is not a retail transaction — departmental chargebacks, institutional service fees, commissions. Do not include central funding or subsidy, which has its own field below.",
          reviewerNote:
            "New for 2026. Meant to catch revenue that runs through the store's books but is not a retail sale. Risk is that it becomes a dumping ground, or that stores put central funding here instead of in its own field. Is the boundary clear?",
          group: "Non-Retail Revenue",
          indent: true,
        },
        {
          name: "other_non_retail_description",
          label: "Description of Other Non-Retail Revenue",
          type: "text",
          helpText:
            "If you entered an amount above, say in a line or two where it comes from.",
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
          helpText:
            "Retail plus Inclusive Access plus other non-retail. This is the figure used for gross margin, net margin, HR percentage and every per-student and per-square-foot comparison in your report.",
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
          helpText:
            "Online as a share of retail revenue only. Inclusive Access is excluded, so stores with and without an IA programme stay comparable.",
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
          helpText:
            "Cost of goods sold for the fiscal year, all product categories. This is the store's cost of product — not the institution's budget for the store, and not your total operating expenses.",
          reviewerNote:
            "In 2025 several stores reported figures that looked like institutional budgets rather than store cost of goods, and the form gave us no way to tell. Does the wording now rule that out?",
          order: 1,
          visible: true,
          required: true,
        },
        {
          name: "expense_hr",
          label: "HR Expense (Salaries, Wages, Benefits)",
          type: "currency",
          helpText:
            "All staff costs: salaries, wages, benefits and payroll taxes, for full-time, part-time and student employees. If your institution carries some of these centrally and does not charge them back to you, report only what hits your books, and say so in the notes.",
          reviewerNote:
            "Some institutions carry staff costs centrally and never charge them to the store, so 2025 HR figures were not comparable — a store showing very low HR might be well run or might simply not be billed. Does the wording get us the right number, or at least a note explaining which?",
          order: 2,
          visible: true,
          required: true,
        },
        {
          name: "expense_rent_maintenance",
          label: "Rent & Occupancy",
          type: "currency",
          helpText:
            "Rent, maintenance, utilities and other occupancy costs. If your institution does not charge the store rent, enter 0 rather than leaving this blank — 0 and blank mean different things to us.",
          reviewerNote:
            "In 2025 we could not tell a store that pays no rent from a store that skipped the question. Both arrived as blank. Does asking for an explicit 0 fix that, and will people actually do it?",
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
          reviewerNote:
            "Some 2025 figures appeared to include revenue from outside the store. Is it clear this is the store's bottom line only, and that losses go in as negatives?",
        },
        {
          name: "marketing_spend",
          label: "Marketing & Promotions",
          type: "currency",
          helpText:
            "Advertising, promotions, sponsorships, printed materials and paid social, for the fiscal year.",
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
          helpText:
            "Total revenue less cost of goods sold. Calculated for you.",
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
          helpText:
            "Gross margin as a share of total revenue. Most campus stores land between 20% and 35%. If yours falls outside that, it is worth a second look before you submit — usually it means revenue and COGS are being measured on different bases.",
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
          helpText: "Net profit as a share of total revenue.",
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
          helpText:
            "HR expense as a share of total revenue. This is a cost measure, so in your report a lower figure ranks better.",
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
          helpText:
            "Headcount of full-time positions, not FTE. Count filled positions, not budgeted ones.",
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
          helpText:
            "Student employees converted to full-time equivalent, averaged across the year. Use the same conversion as above.",
          order: 3,
          visible: true,
        },
        // Manager Experience group
        {
          name: "manager_years_current_position",
          label: "Years in Current Position",
          type: "number",
          helpText:
            "How long the current store manager or director has held this role at your institution.",
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
          helpText:
            "Total years the current manager has worked in campus retail, at any institution.",
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
          helpText:
            "New print textbooks and required course texts, total across all channels.",
          order: 1,
          visible: true,
          group: "Print — New",
        },
        {
          name: "cm_print_new_online",
          label: "Print — New (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 2,
          visible: true,
          group: "Print — New",
        },
        {
          name: "cm_print_used_total",
          label: "Print — Used (Total)",
          type: "currency",
          helpText:
            "Used print textbooks, including buyback resale, total across all channels.",
          order: 3,
          visible: true,
          group: "Print — Used",
        },
        {
          name: "cm_print_used_online",
          label: "Print — Used (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 4,
          visible: true,
          group: "Print — Used",
        },
        {
          name: "cm_custom_courseware_total",
          label: "Custom Courseware (Total)",
          type: "currency",
          helpText:
            "Custom-published or institution-specific course materials, total across all channels.",
          order: 5,
          visible: true,
          group: "Custom Courseware",
        },
        {
          name: "cm_custom_courseware_online",
          label: "Custom Courseware (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 6,
          visible: true,
          group: "Custom Courseware",
        },
        {
          name: "cm_rentals_total",
          label: "Rentals (Total)",
          type: "currency",
          helpText: "Textbook rental revenue, total across all channels.",
          order: 7,
          visible: true,
          group: "Rentals",
        },
        {
          name: "cm_rentals_online",
          label: "Rentals (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 8,
          visible: true,
          group: "Rentals",
        },
        {
          name: "cm_digital_total",
          label: "Digital / E-Content (Total)",
          type: "currency",
          helpText:
            "Digital textbooks, e-books and access codes sold as retail transactions, total across all channels.",
          order: 9,
          visible: true,
          group: "Digital / E-Content",
        },
        {
          name: "cm_digital_online",
          label: "Digital / E-Content (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 10,
          visible: true,
          group: "Digital / E-Content",
        },
        {
          name: "cm_inclusive_access_total",
          label: "Inclusive Access (Total)",
          type: "currency",
          helpText:
            "The course materials value inside your Inclusive Access programme. This is the product view of the same programme you reported as revenue in Sales Revenue — the two are complementary, not duplicates. Leave blank if you do not run one.",
          reviewerNote:
            "Sits alongside the IA revenue field in Sales Revenue and the two are easy to confuse. One is the revenue stream, the other is the product mix inside it. Does the wording make them feel complementary rather than duplicated?",
          order: 11,
          visible: true,
          group: "Inclusive Access",
          note: "Captures retail-channel IA revenue. If your IA program generates non-retail revenue (e.g., courseware-as-fee), report that in Section 2.",
        },
        {
          name: "cm_inclusive_access_online",
          label: "Inclusive Access (Online)",
          type: "currency",
          helpText:
            "The portion of the line above delivered through your web store rather than the registrar.",
          order: 12,
          visible: true,
          group: "Inclusive Access",
        },
        {
          name: "cm_course_packs_total",
          label: "Course Packs (Total)",
          type: "currency",
          helpText: "Coursepacks and readers, total across all channels.",
          order: 13,
          visible: true,
          group: "Course Packs",
        },
        {
          name: "cm_course_packs_online",
          label: "Course Packs (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 14,
          visible: true,
          group: "Course Packs",
        },
        {
          name: "cm_other_total",
          label: "Other (Total)",
          type: "currency",
          helpText: "Course materials that do not fit the categories above.",
          order: 15,
          visible: true,
          group: "Other",
        },
        {
          name: "cm_other_online",
          label: "Other (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 16,
          visible: true,
          group: "Other",
        },
        // Calculated totals
        {
          name: "_calc_total_cm",
          label: "Total Course Materials Revenue",
          type: "currency",
          helpText:
            "Sum of the category totals above. This should not exceed your total revenue.",
          order: 17,
          visible: true,
          calculated: { formula: "total_course_materials", format: "currency" },
          group: "Totals",
        },
        {
          name: "_calc_total_cm_online",
          label: "Total Course Materials Online",
          type: "currency",
          helpText: "Sum of the online sub-columns above.",
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
          helpText:
            "Lab coats, art supplies, safety equipment, calculators and anything else required by a course syllabus.",
          order: 1,
          visible: true,
        },
        {
          name: "sales_course_supplies_online",
          label: "Course-Required Supplies (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 2,
          visible: true,
        },
        // Product Categories group
        {
          name: "sales_general_books",
          label: "General / Trade Books",
          type: "currency",
          helpText: "Trade and general-interest books. Not course texts.",
          order: 3,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_technology",
          label: "Technology",
          type: "currency",
          helpText:
            "Computers, tablets, peripherals, accessories and software sold at retail.",
          order: 4,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_stationary",
          label: "Stationery",
          type: "currency",
          helpText:
            "Notebooks, pens, paper and general office supplies not required by a syllabus.",
          order: 5,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_apparel",
          label: "Apparel (Total)",
          type: "currency",
          helpText:
            "All clothing and wearables. The imprinted and non-imprinted lines below should add up to this.",
          order: 6,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_apparel_imprint",
          label: "Imprinted",
          type: "currency",
          helpText: "Apparel carrying your institution's name, crest or logo.",
          order: 7,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_apparel_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          helpText: "Apparel without institutional branding.",
          order: 8,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_gifts_drinkware",
          label: "Gifts & Drinkware (Total)",
          type: "currency",
          helpText:
            "All gifts and drinkware. The two lines below should add up to this.",
          order: 9,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_gifts_imprint",
          label: "Imprinted",
          type: "currency",
          helpText: "Gifts and drinkware carrying institutional branding.",
          order: 10,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_gifts_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          helpText: "Gifts and drinkware without institutional branding.",
          order: 11,
          visible: true,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_custom_merch",
          label: "Custom / Licensed Merchandise",
          type: "currency",
          helpText:
            "Institution-branded merchandise that is not apparel, gifts or drinkware — pennants, decals, regalia and the like.",
          order: 12,
          visible: true,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_food_beverage",
          label: "Food & Beverage",
          type: "currency",
          helpText:
            "Food, drink and confectionery, including any cafe you operate.",
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
          helpText:
            "The point-of-sale system you run day to day. Choose Other and tell us if yours is not listed.",
          order: 1,
          visible: true,
          placeholder: "e.g., MBS, Bookware, Ratex, Square",
        },
        {
          name: "ebook_delivery_system",
          label: "eBook Delivery System",
          type: "text",
          helpText:
            "The platform students use to access digital course materials you sell.",
          order: 2,
          visible: true,
          placeholder: "e.g., VitalSource, RedShelf, Direct from publisher",
        },
        {
          name: "student_info_system",
          label: "Student Information System",
          type: "text",
          helpText:
            "Your institution's SIS — the system of record for registration and course sections.",
          order: 3,
          visible: true,
          placeholder: "e.g., Banner, PeopleSoft",
        },
        {
          name: "lms_system",
          label: "LMS (Learning Management System)",
          type: "text",
          helpText: "The learning management system your institution runs.",
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
          helpText: "How often your store posts, on average across the year.",
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
          helpText: "Who actually writes and posts. Choose the closest match.",
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
          helpText:
            "Services you offer around the buying experience, such as price matching, personal shopping or curbside pickup.",
          order: 10,
          visible: true,
          placeholder: "e.g., Curbside Pickup, Same-day Delivery, Ship to Home",
          group: "Services & Operations",
          indent: true,
        },
        {
          name: "store_in_stores",
          label: "Store-in-Stores",
          type: "text",
          helpText:
            "Branded concessions or partner shops operating inside your footprint.",
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
          helpText:
            "How often you count stock. Choose every option that applies if different categories are counted on different cycles.",
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
          helpText: "Your usual weekday opening time outside rush periods.",
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
          helpText: "Your usual weekday closing time outside rush periods.",
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
          helpText: "Leave blank if you do not open on Saturdays.",
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
          helpText: "Leave blank if you do not open on Saturdays.",
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
          helpText: "Leave blank if you do not open on Sundays.",
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
          helpText: "Leave blank if you do not open on Sundays.",
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
          helpText:
            "Yes if you extend or reduce hours around rush, exams or the summer.",
          order: 7,
          visible: true,
        },
        // Shrinkage group
        {
          name: "shrink_textbooks",
          label: "Textbooks Shrink %",
          type: "percentage",
          helpText:
            "Shrinkage on course materials as a percentage of course materials sales, from your most recent count.",
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
          helpText:
            "Shrinkage on general merchandise as a percentage of general merchandise sales, from your most recent count.",
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
          helpText:
            "Whether your store records how many course sections submit adoption information by your deadline. If you do not track this yet, answer No and skip the next two questions — we expect a lot of Nos this year.",
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
          helpText:
            "How far ahead of the term your adoption deadline falls. We are asking because deadlines vary widely, and knowing yours is what lets us compare completion rates fairly.",
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
  formData: Record<string, unknown>,
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
      return totalRev3 > 0 ? (num("net_profit") / totalRev3) * 100 : null;
    }

    case "hr_pct_of_revenue": {
      const totalRev4 =
        num("total_gross_sales_instore") +
        num("total_online_sales") +
        num("ia_revenue") +
        num("other_non_retail_revenue");
      return totalRev4 > 0 ? (num("expense_hr") / totalRev4) * 100 : null;
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
  formData: Record<string, unknown>,
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
