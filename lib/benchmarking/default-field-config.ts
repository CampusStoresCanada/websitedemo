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
  | "multiselect"
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
  /**
   * Offer a "Something else? Type it and press Enter" box under the control.
   *
   * On a multiselect it adds a value to the list; on a select it becomes the
   * answer. Either way it replaces the "Other" option plus companion text
   * field, which asked one question twice and stored it in two places.
   */
  allowOther?: boolean;
  /** Visual group heading this field belongs to */
  group?: string;
  /**
   * Fields sharing a `row` value render side by side on one line.
   *
   * Exists because a fiscal year end is one question — "Smarch 32" should not
   * occupy two full-width rows of a form just because it takes two controls to
   * answer. Set `rowLabel` on the first field of the row to caption the pair.
   */
  row?: string;
  /** Caption for the whole row. Only read from the first field in it. */
  rowLabel?: string;
  /** Help text for the whole row, read from the first field in it. */
  rowHelpText?: string;
  /** Indent level: true = 1 level, or a number for deeper nesting */
  indent?: boolean | number;
  /**
   * Conditional visibility — hide unless another field has a matching value.
   *
   * An array means "any of these". Needed the moment one follow-up serves two
   * answers: §10 asks who runs the programme, and both "a third party" and
   * "other" need the same "who, and how does that work?" box under them.
   */
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
// Deliberately alone: these are text[] columns. Retyping one to `text` would
// mean every stored array has to be flattened, and back again is worse.
const MULTI_TYPES: FieldType[] = ["multiselect"];

export function getCompatibleTypes(currentType: FieldType): FieldType[] {
  if (TEXT_TYPES.includes(currentType)) return TEXT_TYPES;
  if (NUMBER_TYPES.includes(currentType)) return NUMBER_TYPES;
  if (BOOLEAN_TYPES.includes(currentType)) return BOOLEAN_TYPES;
  if (MULTI_TYPES.includes(currentType)) return MULTI_TYPES;
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
        /*
          visible:false — these four are now driven by RespondentPicker, which
          renders above the section. They stay in the config and in
          FIELD_REGISTRY because they are still the RECORD of who was named at
          the time, written by setRespondent() and read by reviewers in
          November. What changed is that nobody retypes them.
        */
        {
          name: "respondent_name",
          label: "Who compiled these figures",
          type: "text",
          order: 0.1,
          visible: false,
          required: true,
          group: "Who to contact about this submission",
          helpText:
            "The person who actually pulled these numbers together. Often not the account holder — if a colleague did the work, put their name here so a question in November reaches them and not you.",
        },
        {
          name: "respondent_title",
          label: "Their job title",
          type: "text",
          order: 0.2,
          visible: false,
          group: "Who to contact about this submission",
          helpText: "How they would introduce themselves. It tells a reviewer whether to ask about the POS export or the P&L.",
        },
        {
          name: "respondent_email",
          label: "Their email",
          type: "text",
          order: 0.3,
          visible: false,
          required: true,
          group: "Who to contact about this submission",
          helpText: "Where a question about these figures should go.",
        },
        {
          name: "respondent_phone",
          label: "Their phone",
          type: "text",
          order: 0.4,
          visible: false,
          group: "Who to contact about this submission",
          helpText:
            "Most flags are settled in a two-minute call rather than a thread. A direct line or extension saves a reviewer going through the switchboard.",
        },
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
          /*
            Settled by the ED, 2026-09-25, after question review deadlocked.

            Two reviewers gave opposite instructions: Shane said combine all
            campuses, LuAnne said the opposite and gave the reason — Memorial is
            ~14,000 FTE across Marine Institute and Grenfell, each with its own
            bookstore and separate reporting lines, so a store serving 1,500
            reporting 14,000 is simply wrong. Karin and Shannon separately asked
            undergrad or undergrad plus grad.

            Three axes, one answer each: scope is the market YOUR store serves,
            population is everybody, and the formula only matters if the
            institution does not already publish an FTE. That last part is the
            point of the whole thing — every institution already reports a
            number to its province. We want that number, not a better one.
          */
          helpText:
            "The students your store serves. If your institution has several campuses and yours is the only store, count all of them. If it has several bookstores and yours is one of them, count only the students your store serves.\n\nFull-time equivalent, undergraduate and graduate, full-year registration, whatever that means at your institution. This is the number your institution reports to your provincial or territorial government, so take it from there rather than working it out yourself.\n\nIf your institution only publishes a headcount, convert it: one part-time student counts as three fifths of a full-time student. Round up to the nearest whole student at the end of the calculation, not at each step.",
          reviewerNote:
            "Rewritten 2026-09-25 from the ED's ruling, replacing 'for the whole institution' which is what Shane and LuAnne disagreed about. The 3/5 conversion is LuAnne's, and it is deliberately the fallback rather than the method: if your institution already reports an FTE we want theirs, inconsistencies and all, because that is the number they are measured on. Does the multi-store case read clearly to a store that is one of several?",
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
          visible: false,
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
          name: "fiscal_year_end_month",
          label: "Month",
          type: "select",
          // One question, two controls, one line. See `row` on FieldConfig.
          row: "fiscal_year_end",
          rowLabel: "Fiscal Year End",
          rowHelpText:
            "The day your fiscal year closes. Asked as two lists rather than a text box, because free text gives us \"Apr 30\", \"04/30\" and \"April 30th\" for the same date — and pairing consecutive year-ends is exactly what inventory turns and GMROI depend on.",
          order: 10,
          visible: true,
          options: [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ],
        },
        {
          name: "fiscal_year_end_day",
          label: "Day",
          type: "select",
          row: "fiscal_year_end",
          order: 10.1,
          visible: true,
          options: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")),
        },
        {
          name: "inventory_count_style",
          label: "How do you count inventory?",
          type: "select",
          helpText:
            "Count dates go in Your year ahead below, so a reviewer can see when your figures were last verified against a shelf.",
          order: 10.2,
          visible: true,
          options: ["Annual", "Bi-annual", "Cycle Counts"],
          allowOther: true,
        },
        {
          /*
            Replaced by the type-and-Enter box on the question above, which
            stores what the store typed as the answer itself. Kept hidden so
            any 2025 value already in this column is still readable.
          */
          name: "inventory_count_style_other",
          label: "Describe how you count",
          type: "text",
          order: 10.3,
          visible: false,
          indent: true,
        },
        {
          name: "does_book_buyback",
          label: "Do you buy books back from students?",
          type: "boolean",
          helpText:
            "If you do, add each buyback window to Your year ahead below — the dates matter as much as the fact.",
          order: 10.4,
          visible: true,
        },
        // Square Footage Breakdown group
        {
          name: "sqft_salesfloor",
          label: "Sales Floor",
          type: "number",
          helpText:
            "Space customers can walk in. Exclude stockrooms, offices and receiving.",
          order: 11,
          visible: false,
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
          visible: false,
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
          visible: false,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
        {
          name: "sqft_other",
          label: "Other",
          type: "number",
          helpText:
            "Anything not covered above. Sales floor, storage, office and other should add up to Total Store Space.",
          order: 14,
          visible: false,
          suffix: "sq ft",
          group: "Square Footage Breakdown",
          indent: true,
        },
        {
          name: "total_square_footage",
          reviewerNote:
            "In 2025 the parts did not always add up to the whole, and we could not tell whether storage and office were meant to be inside this number. Is it clear now?",
          label: "Total Store Space",
          type: "number",
          helpText:
            "Everything above, added up. We work it out from your breakdown rather than asking twice — asking for both is how a total and its parts end up disagreeing.",
          order: 15,
          visible: false,
          group: "Square Footage Breakdown",
          calculated: { formula: "total_square_footage", format: "number" },
        },
        {
          /*
            Who else on or beside campus sells what you sell. Two stores with
            the same enrolment are not in the same market if one of them has a
            Chapters across the road.
          */
          name: "competing_stores_count",
          label: "How many other stores compete with you for this business?",
          type: "integer",
          helpText:
            "On campus or close enough that a student would walk there instead. Count each store, not each chain.",
          order: 60,
          visible: true,
          group: "Your market",
        },
        {
          name: "competing_stores_notes",
          label: "Who are they?",
          type: "text",
          helpText:
            "Names, or just what they are — a student union shop, a campus convenience store, a chain bookstore nearby.",
          order: 61,
          visible: true,
          indent: true,
          group: "Your market",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 2: General Merchandise
    // ═══════════════════════════════════════════════════════════
    {
      id: "general_merchandise",
      title: "General Merchandise",
      description: "The categories you carry, in the same words the rest of the association uses. Say which ones you sell, break any of them into subcategories if that is how you run them, and leave the rest alone. Merchandise income that fits none of these belongs in Other Income.",
      order: 2,
      fields: [
        {
          name: "sales_course_supplies",
          label: "Course-Required Supplies (Total)",
          type: "currency",
          helpText:
            "Lab coats, art supplies, safety equipment, calculators and anything else required by a course syllabus.",
          order: 1,
          visible: false,
        },
        {
          name: "sales_course_supplies_online",
          label: "Course-Required Supplies (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 2,
          visible: false,
        },
        // Product Categories group
        {
          name: "sales_general_books",
          label: "General / Trade Books",
          type: "currency",
          helpText: "Trade and general-interest books. Not course texts.",
          order: 3,
          visible: false,
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
          visible: false,
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
          visible: false,
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
          visible: false,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_apparel_imprint",
          label: "Imprinted",
          type: "currency",
          helpText: "Apparel carrying your institution's name, crest or logo.",
          order: 7,
          visible: false,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_apparel_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          helpText: "Apparel without institutional branding.",
          order: 8,
          visible: false,
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
          visible: false,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "sales_gifts_imprint",
          label: "Imprinted",
          type: "currency",
          helpText: "Gifts and drinkware carrying institutional branding.",
          order: 10,
          visible: false,
          group: "Product Categories",
          indent: 2,
        },
        {
          name: "sales_gifts_non_imprint",
          label: "Non-Imprinted",
          type: "currency",
          helpText: "Gifts and drinkware without institutional branding.",
          order: 11,
          visible: false,
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
          visible: false,
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
          visible: false,
          group: "Product Categories",
          indent: true,
        },
        {
          name: "total_gross_sales_instore",
          reviewerNote:
            "THE BIG ONE. In 2025 some stores put their whole sales figure here and others split it across this and Online, and nothing in the response told us which. Every institution had to be classified by hand, and where we guessed wrong the numbers were wrong. Does the wording now make it impossible to enter a combined total here?",
          label: "Total in-store sales",
          type: "currency",
          helpText: "Superseded by the category lines above, which add up to this.",
          order: 900,
          visible: false,
        },
        {
          name: "total_online_sales",
          reviewerNote:
            "Other half of the 2025 sales-column problem. Also unclear in 2025 whether an online order collected in store counted as online or in-store \u2014 stores split both ways. Does the wording settle that?",
          label: "Total online sales",
          type: "currency",
          helpText: "Superseded by the Online column on each category line.",
          order: 901,
          visible: false,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 3: Course Materials
    // ═══════════════════════════════════════════════════════════
    {
      id: "course_materials",
      title: "Course Materials",
      description: "Course materials on the same category lines as everything else. The questions below are the ones that only make sense for course materials.",
      order: 3,
      fields: [
        {
          name: "cm_print_new_total",
          label: "Print — New (Total)",
          type: "currency",
          helpText:
            "New print textbooks and required course texts, total across all channels.",
          order: 1,
          visible: false,
          group: "Print — New",
        },
        {
          name: "cm_print_new_online",
          label: "Print — New (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 2,
          visible: false,
          group: "Print — New",
        },
        {
          name: "cm_print_used_total",
          label: "Print — Used (Total)",
          type: "currency",
          helpText:
            "Used print textbooks, including buyback resale, total across all channels.",
          order: 3,
          visible: false,
          group: "Print — Used",
        },
        {
          name: "cm_print_used_online",
          label: "Print — Used (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 4,
          visible: false,
          group: "Print — Used",
        },
        {
          name: "cm_custom_courseware_total",
          label: "Custom Course Materials (Total)",
          type: "currency",
          helpText:
            "Custom-published or institution-specific course materials, total across all channels.",
          order: 5,
          visible: false,
          group: "Custom Course Materials",
        },
        {
          name: "cm_custom_courseware_online",
          label: "Custom Course Materials (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 6,
          visible: false,
          group: "Custom Course Materials",
        },
        {
          name: "cm_rentals_total",
          label: "Rentals (Total)",
          type: "currency",
          helpText: "Textbook rental revenue, total across all channels.",
          order: 7,
          visible: false,
          group: "Rentals",
        },
        {
          name: "cm_rentals_online",
          label: "Rentals (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 8,
          visible: false,
          group: "Rentals",
        },
        {
          name: "cm_digital_total",
          label: "Digital / E-Content (Total)",
          type: "currency",
          helpText:
            "Digital textbooks, e-books and access codes sold as retail transactions, total across all channels.",
          order: 9,
          visible: false,
          group: "Digital / E-Content",
        },
        {
          name: "cm_digital_online",
          label: "Digital / E-Content (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 10,
          visible: false,
          group: "Digital / E-Content",
        },
        {
          name: "cm_inclusive_access_total",
          label: "IA/EA (Total)",
          type: "currency",
          // Named like its siblings — Print — New, Rentals, Digital — because
          // that is what it is: one more channel in this list. Reviewers read it
          // as a question about revenue booking, or as asking for everything
          // EXCEPT books, and both misreadings come from it not looking like the
          // rest of the list it sits in.
          helpText:
            "Course materials supplied through your Inclusive Access or Equitable Access programme. One more channel in this list — the same question asked of print, rentals and digital, asked of IA/EA. Course materials only: general merchandise bundled into the programme goes in General Merchandise. Leave blank if you do not run one.",
          reviewerNote:
            "Rewritten 2026-09. This used to say it was 'the product view of the same programme you reported as revenue in Sales Revenue — the two are complementary, not duplicates', and that sentence was doing the damage. It reached three sections back to a question with a different subject, and reviewers read it as one number asked twice.\\n\\nThis question is WHAT THE PROGRAMME CONTAINS. The Sales Revenue one is WHERE THE MONEY IS BOOKED. They are not the same quantity and neither is a subset of the other.\\n\\nThe bundle exclusion is the part to check: does a store running a bundle with a lab kit in it know to strip the kit out here?",
          order: 11,
          visible: false,
          group: "Inclusive Access / Equitable Access",
        },
        {
          name: "cm_inclusive_access_online",
          label: "IA/EA (Online)",
          type: "currency",
          // Worded exactly like the other (Online) lines in this list, for the
          // same reason the label is: it is one more channel, not a special case.
          helpText: "The portion of the line above sold through your web store.",
          order: 12,
          visible: false,
          group: "Inclusive Access / Equitable Access",
        },
        {
          name: "cm_course_packs_total",
          label: "Course Packs (Total)",
          type: "currency",
          helpText: "Coursepacks and readers, total across all channels.",
          order: 13,
          visible: false,
          group: "Course Packs",
        },
        {
          name: "cm_course_packs_online",
          label: "Course Packs (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 14,
          visible: false,
          group: "Course Packs",
        },
        {
          name: "cm_other_total",
          label: "Other (Total)",
          type: "currency",
          helpText: "Course materials that do not fit the categories above.",
          order: 15,
          visible: false,
          group: "Other",
        },
        {
          name: "cm_other_online",
          label: "Other (Online)",
          type: "currency",
          helpText:
            "The portion of the line above sold through your web store.",
          order: 16,
          visible: false,
          group: "Other",
        },
        /*
          Retired with the category rebuild, not deleted.

          These add up the old cm_* columns, which nothing writes any more — so
          they rendered a permanent "$0" at the top of the section while the
          real figures sat in the category grid below. A total that is always
          zero is worse than no total: it tells a store the form is broken at
          the exact moment we are asking it to trust the form.
        */
        {
          name: "_calc_total_cm",
          label: "Total Course Materials Revenue",
          type: "currency",
          helpText:
            "Sum of the category totals above. This should not exceed your total revenue.",
          order: 17,
          visible: false,
          calculated: { formula: "total_course_materials", format: "currency" },
          group: "Totals",
        },
        {
          name: "_calc_total_cm_online",
          label: "Total Course Materials Online",
          type: "currency",
          helpText: "Sum of the online sub-columns above.",
          order: 18,
          visible: false,
          calculated: {
            formula: "total_course_materials_online",
            format: "currency",
          },
          group: "Totals",
        },
        {
          /*
            Physical only, and said so out loud. Digital and IA have no
            sell-through in any sense that compares to a shelf of print — a
            single number covering both is the kind of figure nobody trusts and
            everybody quotes.
          */
          name: "cm_sell_through_pct",
          label: "Sell-through on physical course materials",
          type: "percentage",
          helpText:
            "Of the physical course materials you brought in for the year, the share that sold before you returned or wrote off the rest. Print only — digital and Inclusive Access are asked separately.",
          order: 500,
          visible: true,
          suffix: "%",
          group: "How the year ran",
        },
        {
          name: "total_transaction_count",
          label: "Total transactions",
          type: "integer",
          helpText:
            "Across every till and the webstore. With sales, this gives an average basket — the figure most stores ask us for first.",
          order: 510,
          visible: true,
          group: "How the year ran",
        },
        {
          name: "tracks_adoptions",
          label: "Do you track faculty adoptions?",
          type: "boolean",
          order: 520,
          visible: true,
          group: "Adoptions",
        },
        {
          name: "total_course_sections",
          label: "Course sections needing materials",
          type: "integer",
          order: 521,
          visible: true,
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
          group: "Adoptions",
        },
        {
          name: "adoptions_by_deadline",
          label: "Of those, adoptions received by your deadline",
          type: "integer",
          order: 522,
          visible: true,
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
          group: "Adoptions",
        },
        {
          name: "adoption_deadline_window",
          label: "Approximately how far ahead is your deadline?",
          type: "select",
          options: [
            "More than 12 weeks before term",
            "8 to 12 weeks before term",
            "4 to 8 weeks before term",
            "Less than 4 weeks before term",
            "We do not set one",
          ],
          order: 523,
          visible: true,
          indent: true,
          showIf: { field: "tracks_adoptions", value: true },
          group: "Adoptions",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 4: Other Income
    // ═══════════════════════════════════════════════════════════
    {
      id: "other_income",
      title: "Other Income",
      description:
        "Money booked through your store that is not merchandise. The services you told us you offer are listed for you. Anything the institution collects on your behalf is asked in Inclusive & Equitable Access instead, because it is not your revenue in the ordinary sense.",
      order: 4,
      fields: [
        {
          name: "central_funding",
          label: "Funding from the institution",
          type: "currency",
          helpText:
            "An operating subsidy, a covered deficit, or any other money the institution gives the store that is not payment for goods. Not a grant you spent on a specific project.",
          order: 1,
          visible: true,
        },
        {
          name: "ia_revenue",
          reviewerNote:
            "This field did not exist in 2025. One college runs a $16M Inclusive Access programme through registration fees; their figures looked broken until a phone call explained it, and we had to add a custom field and asterisk 39 packages. Is this description clear enough that an IA store knows this is where their money goes, and a non-IA store knows to leave it blank?",
          label: "Inclusive Access revenue",
          type: "currency",
          helpText:
            "Superseded by Inclusive & Equitable Access, which asks who collected the money before asking how much.",
          order: 900,
          visible: false,
        },
        {
          name: "other_non_retail_revenue",
          reviewerNote:
            "New for 2026. Meant to catch revenue that runs through the store's books but is not a retail sale. Risk is that it becomes a dumping ground, or that stores put central funding here instead of in its own field. Is the boundary clear?",
          label: "Other non-retail revenue",
          type: "currency",
          helpText: "Superseded by the income lines you name yourself above.",
          order: 901,
          visible: false,
        },
        {
          name: "other_non_retail_description",
          label: "Describe that revenue",
          type: "text",
          order: 902,
          visible: false,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 5: Campus Contributions
    // ═══════════════════════════════════════════════════════════
    {
      id: "campus_contributions",
      title: "Campus Contributions",
      order: 5,
      fields: [
        {
          name: "contrib_discounts",
          label: "Discounts given to students",
          type: "currency",
          order: 1,
          visible: true,
          helpText: "Everything you took off the shelf price for a student over the year. The single largest way most stores subsidise their campus.",
        },
        {
          name: "contrib_rent_to_institution",
          label: "Rent paid to the institution",
          type: "currency",
          order: 2,
          visible: true,
          helpText: "What you pay your own university or college for the space you occupy.",
        },
        {
          name: "contrib_commissions",
          label: "Commissions paid to the institution",
          type: "currency",
          order: 3,
          visible: true,
          helpText: "A share of sales handed back, however it is described in your agreement.",
        },
        {
          name: "contrib_donations",
          label: "Donations",
          type: "currency",
          order: 4,
          visible: true,
          helpText: "Cash and goods given to campus groups, events and causes.",
        },
        {
          name: "contrib_scholarships",
          label: "Scholarships and bursaries",
          type: "currency",
          order: 5,
          visible: true,
          helpText: "Funded by the store, whether awarded in your name or the institution's.",
        },
        {
          name: "contrib_bad_debt",
          label: "Bad debt written off",
          type: "currency",
          order: 6,
          visible: true,
          helpText: "Departmental and student accounts you carried and never collected.",
        },
        {
          name: "contrib_rebates",
          label: "Rebates returned",
          type: "currency",
          order: 7,
          visible: true,
          helpText: "Money handed back to the institution or to students at year end.",
        },
        {
          name: "expense_university_admin",
          label: "University administrative charge",
          type: "currency",
          order: 8,
          visible: true,
          helpText: "What the institution charges you for central services. It also appears in Expenses \u2014 entered once, counted once.",
        },
        {
          name: "contrib_other_agreements",
          label: "Other campus agreements and sponsorships",
          type: "currency",
          order: 9,
          visible: true,
          helpText: "Anything else you fund that is not covered above.",
        },
        {
          name: "contrib_local_marketing",
          label: "Spent on local marketing",
          type: "currency",
          order: 10,
          visible: true,
          helpText: "Advertising bought locally, including with campus media.",
        },
        {
          /*
            Asked in Staffing instead, where the other wage lines are, and read
            from there into the contribution total. Two fields for one figure
            meant a store could answer both and have them disagree.
          */
          name: "contrib_student_wages",
          label: "Paid in student wages",
          type: "currency",
          order: 11,
          visible: false,
          helpText:
            "Answered in Staffing, with the other wage lines, and counted toward your campus contribution from there.",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 6: Staffing
    // ═══════════════════════════════════════════════════════════
    {
      id: "staffing",
      title: "Staffing",
      description: "Headcount, what it costs, and how much campus retail experience is on the floor. The wage lines here add up to the salaries figure in Expenses.",
      order: 6,
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
          group: "Headcount",
        },
        {
          name: "parttime_fte_offpeak",
          label: "Part-Time FTE (Off-Peak)",
          type: "number",
          order: 2,
          visible: true,
          helpText: "Part-time staff expressed as FTE during off-peak",
          group: "Headcount",
        },
        {
          name: "student_fte_average",
          label: "Student FTE (Average)",
          type: "number",
          helpText:
            "Student employees converted to full-time equivalent, averaged across the year. Use the same conversion as above.",
          order: 3,
          visible: true,
          group: "Headcount",
        },
        // Manager Experience group
        {
          name: "manager_years_current_position",
          label: "Years in Current Position",
          type: "number",
          helpText:
            "How long the current store manager or director has held this role at your institution.",
          order: 4,
          visible: false,
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
          visible: false,
          suffix: "years",
          group: "Manager Experience",
          indent: true,
        },
        {
          name: "seasonal_employees",
          label: "Seasonal employees at peak",
          type: "number",
          helpText:
            "People you take on for rush and let go afterwards, counted at your busiest week.",
          order: 4,
          visible: true,
          group: "Headcount",
        },
        {
          name: "wages_full_time",
          label: "Full-time wages",
          type: "currency",
          order: 10,
          visible: true,
          group: "What it costs",
        },
        {
          name: "wages_part_time",
          label: "Part-time wages",
          type: "currency",
          order: 11,
          visible: true,
          group: "What it costs",
        },
        {
          name: "wages_seasonal",
          label: "Seasonal wages",
          type: "currency",
          order: 12,
          visible: true,
          group: "What it costs",
        },
        {
          name: "wages_student",
          label: "Student wages",
          type: "currency",
          helpText:
            "Wages only. Whether this also counts toward your campus contribution is the question under it.",
          order: 13,
          visible: true,
          group: "What it costs",
        },
        {
          /*
            The single largest reason two identical stores show different staff
            costs, and nothing in the old survey could see it. Some institutions
            carry benefits centrally and the store never sees the number; others
            charge it back in full. Asked as one question rather than folded
            into four wage lines, because most stores are under a collective
            agreement covering everybody and cannot split benefits by
            employment type even if we asked.
          */
          name: "benefits_paid_by",
          label: "Who pays your staff benefits?",
          type: "select",
          options: [
            "The store pays them",
            "The institution pays them centrally",
            "Split between the store and the institution",
            "Staff are not eligible for benefits",
          ],
          helpText:
            "The wage lines above are wages only. This asks where the benefit cost lands, so your staff cost can be compared with a store whose institution handles it differently.",
          order: 14,
          visible: true,
          allowOther: true,
          group: "What it costs",
        },
        {
          name: "benefits_total",
          label: "Benefits the store pays",
          type: "currency",
          helpText:
            "One total across everybody, not split by employment type. Include the employer's share of payroll taxes if your store carries it.",
          order: 15,
          visible: true,
          indent: true,
          showIf: {
            field: "benefits_paid_by",
            value: ["The store pays them", "Split between the store and the institution"],
          },
          group: "What it costs",
        },
        {
          name: "student_wages_is_contribution",
          label: "Count student wages toward your campus contribution?",
          type: "boolean",
          helpText:
            "Most stores do — employing students is one of the clearest ways a store gives back. Some treat it as an ordinary staffing cost because the work would be done either way. Your call: we will use whichever you choose and say which we used.",
          order: 16,
          visible: true,
          indent: true,
          group: "What it costs",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 7: Expenses
    // ═══════════════════════════════════════════════════════════
    {
      id: "expenses",
      title: "Expenses",
      order: 7,
      fields: [
        {
          name: "expense_hr",
          reviewerNote:
            "Some institutions carry staff costs centrally and never charge them to the store, so 2025 HR figures were not comparable \u2014 a store showing very low HR might be well run or might simply not be billed. Does the wording get us the right number, or at least a note explaining which?",
          label: "Salaries, wages and benefits",
          type: "currency",
          order: 1,
          visible: true,
          helpText:
            "All staff costs including payroll taxes and benefits, as it appears on your statements. The wage lines in Staffing break this same total down by employment type, so the two should agree.",
        },
        {
          name: "expense_rent_maintenance",
          reviewerNote:
            "In 2025 we could not tell a store that pays no rent from a store that skipped the question. Both arrived as blank. Does asking for an explicit 0 fix that, and will people actually do it?",
          label: "Rent, maintenance and repairs",
          type: "currency",
          order: 2,
          visible: true,
        },
        {
          name: "expense_utilities",
          label: "Utilities",
          type: "currency",
          order: 3,
          visible: true,
        },
        {
          name: "expense_advertising",
          label: "Advertising and promotion",
          type: "currency",
          order: 4,
          visible: true,
        },
        {
          name: "expense_telephone",
          label: "Telephone and communications",
          type: "currency",
          order: 5,
          visible: true,
        },
        {
          name: "expense_store_supplies",
          label: "Store and business supplies",
          type: "currency",
          order: 6,
          visible: true,
        },
        {
          name: "expense_it",
          label: "Information technology",
          type: "currency",
          order: 7,
          visible: true,
          helpText: "Systems, licences and support. Your POS sits here.",
        },
        {
          name: "expense_postage",
          label: "Postage and shipping",
          type: "currency",
          order: 8,
          visible: true,
          helpText: "In and out.",
        },
        {
          name: "expense_depreciation",
          label: "Depreciation and amortization",
          type: "currency",
          order: 9,
          visible: true,
        },
        {
          name: "expense_professional_services",
          label: "Professional services",
          type: "currency",
          order: 10,
          visible: true,
          helpText: "Audit, legal, consulting.",
        },
        {
          name: "expense_education_travel",
          label: "Education and travel",
          type: "currency",
          order: 11,
          visible: true,
          helpText: "Conferences, training, and getting people there.",
        },
        {
          name: "expense_insurance",
          label: "Business insurance",
          type: "currency",
          order: 12,
          visible: true,
        },
        {
          name: "expense_card_fees",
          label: "Credit and debit card fees",
          type: "currency",
          order: 13,
          visible: true,
          helpText: "Often the largest line a store forgets.",
        },
        {
          name: "marketing_spend",
          label: "Total marketing spend",
          type: "currency",
          order: 14,
          visible: true,
        },
        {
          name: "shrink_at_cost",
          label: "Shrinkage at cost",
          type: "currency",
          order: 20,
          visible: true,
          helpText: "In dollars, not a percentage \u2014 a percentage cannot be reconciled to your P&L. Positive if shrink increased your cost of sales.",
          group: "Shrinkage",
        },
        {
          name: "shrink_at_retail",
          label: "Shrinkage at retail",
          type: "currency",
          order: 21,
          visible: true,
          helpText: "The same loss valued at the price you would have sold it for.",
          group: "Shrinkage",
        },
        {
          name: "shrink_textbooks",
          label: "Textbook shrink",
          type: "percentage",
          helpText:
            "Superseded by shrinkage in dollars, which reconciles to your books. A percentage does not.",
          order: 900,
          visible: false,
        },
        {
          name: "shrink_general_merch",
          label: "General merchandise shrink",
          type: "percentage",
          helpText: "Superseded by shrinkage in dollars.",
          order: 901,
          visible: false,
        },
        {
          name: "fye_inventory_value",
          label: "Year-end inventory value",
          type: "currency",
          helpText:
            "Superseded by the closing inventory you give per category, which adds up to this.",
          order: 902,
          visible: false,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 8: Review
    // ═══════════════════════════════════════════════════════════
    {
      id: "review_financials",
      title: "Review",
      description:
        "Everything you have entered, as one statement. Nothing here is typed in — every line is built from your answers, so hover a line to see where it came from, or click it to go back and change it.",
      order: 8,
      fields: [
        {
          name: "total_cogs",
          reviewerNote:
            "In 2025 several stores reported figures that looked like institutional budgets rather than store cost of goods, and the form gave us no way to tell. Does the wording now rule that out?",
          label: "Total cost of goods sold",
          type: "currency",
          helpText:
            "Derived from the gross margin you gave each category. Asking for it separately invited the two figures to disagree.",
          order: 900,
          visible: false,
        },
        {
          name: "net_profit",
          reviewerNote:
            "Some 2025 figures appeared to include revenue from outside the store. Is it clear this is the store's bottom line only, and that losses go in as negatives?",
          label: "Net profit",
          type: "currency",
          helpText: "Derived: gross margin less operating expenses.",
          order: 901,
          visible: false,
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 9: Technology & Systems
    // ═══════════════════════════════════════════════════════════
    {
      id: "technology_systems",
      title: "Technology & Systems",
      description:
        "Select all that apply — a store mid-migration genuinely runs two, and the old single-answer version made it pick one. Picked from lists rather than typed, because free text gave us NetSuite and Oracle Netsuite as two systems and Prism three ways, which made a question about what the sector runs on unanswerable. If yours is missing, type it in the box under the list and press Enter.",
      order: 9,
      fields: [
        {
          /*
            Option spellings match what stores actually entered in 2025, so a
            carried answer ticks its box instead of arriving as a stray chip.
            The ones that genuinely differ stay visible as chips rather than
            being rewritten — deciding that "Oracle Netsuite" meant "NetSuite"
            is the store's call to make, not ours to make on their behalf.
          */
          name: "pos_system",
          label: "Point of sale",
          type: "multiselect",
          options: [
            "Carleton Technologies - Bookware",
            "PrismRBS",
            "Lightspeed",
            "NetSuite",
            "MBS",
            "Ratex",
            "Waterloo Information Systems (WISL)",
            "Built in house",
          ],
          order: 1,
          visible: true,
        },
        {
          name: "ebook_delivery_system",
          label: "eBook delivery",
          type: "multiselect",
          options: ["CEI", "VitalSource", "Kivuto", "Built in house"],
          order: 2,
          visible: true,
        },
        {
          name: "student_info_system",
          label: "Student information system",
          type: "multiselect",
          options: [
            "Banner",
            "PeopleSoft",
            "Colleague",
            "Workday Student",
            "Omnivox",
            "Salesforce",
            "Built by the institution",
          ],
          order: 3,
          visible: true,
        },
        {
          name: "lms_system",
          label: "Learning management system",
          type: "multiselect",
          options: ["D2L/Brightspace", "Moodle", "Canvas", "Blackboard", "LEA"],
          order: 4,
          visible: true,
        },
        {
          name: "payment_options",
          label: "How can a customer pay?",
          type: "multiselect",
          options: [
            "Cash",
            "Debit",
            "Credit",
            "Student account",
            "Departmental charge",
            "Financial aid or bursary",
            "Campus card",
            "Tap to pay on mobile",
            "Buy now, pay later",
            "Gift card",
          ],
          order: 20,
          visible: true,
          group: "Payments",
        },
        {
          name: "store_in_stores",
          label: "Do you run a store inside another store?",
          type: "text",
          helpText:
            "A branded shop within your space, or your shop inside somebody else's. Name it if so.",
          order: 30,
          visible: true,
          group: "Channels",
        },
        {
          name: "social_media_platforms",
          label: "Where are you posting?",
          type: "multiselect",
          options: [
            "Instagram",
            "Facebook",
            "TikTok",
            "X",
            "LinkedIn",
            "YouTube",
            "Snapchat",
            "Threads",
            "Reddit",
            "Discord",
          ],
          order: 40,
          visible: true,
          group: "Social",
        },
        {
          name: "social_media_frequency",
          label: "How often?",
          type: "select",
          options: [
            "Several times a day",
            "Daily",
            "A few times a week",
            "Weekly",
            "A few times a month",
            "Less than monthly",
          ],
          order: 41,
          visible: true,
          indent: true,
          group: "Social",
        },
        {
          name: "social_media_run_by",
          label: "Who runs it?",
          type: "select",
          options: [
            "Store staff, as part of their job",
            "A student employee",
            "A dedicated marketing person",
            "The institution's marketing department",
            "An agency",
            "Nobody in particular",
          ],
          order: 42,
          visible: true,
          indent: true,
          group: "Social",
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // Section 10: Inclusive & Equitable Access
    // ═══════════════════════════════════════════════════════════
    {
      id: "inclusive_access",
      title: "Inclusive & Equitable Access",
      order: 10,
      fields: [
        {
          name: "ia_ea_program_type",
          label: "Do you run an Inclusive Access or Equitable Access programme?",
          type: "select",
          order: 1,
          visible: true,
          options: ["Inclusive Access", "Equitable Access", "Both", "Neither"],
          helpText: "If you run neither, nothing else in this section applies.",
          allowOther: true,
        },
        {
          /*
            Replaced by the type-and-Enter box on the question above, which
            stores what the store typed as the answer itself. Kept hidden so
            any 2025 value already in this column is still readable.
          */
          name: "ia_ea_program_type_other",
          label: "Tell us what you run",
          type: "text",
          order: 1.1,
          visible: false,
          indent: true,
        },
        {
          name: "ia_ea_enrolment_model",
          label: "Is it opt-in or opt-out?",
          type: "select",
          order: 2,
          visible: true,
          options: ["Opt-in", "Opt-out"],
          helpText: "Whether a student is in the programme by default, or has to choose it.",
          allowOther: true,
        },
        {
          /*
            Replaced by the type-and-Enter box on the question above, which
            stores what the store typed as the answer itself. Kept hidden so
            any 2025 value already in this column is still readable.
          */
          name: "ia_ea_enrolment_model_other",
          label: "Describe how students join or leave",
          type: "text",
          order: 2.1,
          visible: false,
          indent: true,
        },
        {
          name: "ia_ea_operated_by",
          label: "Who runs it?",
          type: "select",
          order: 3,
          visible: true,
          options: ["In house", "The institution", "A third party", "Other"],
        },
        {
          name: "ia_ea_operated_by_other",
          label: "Who, and how does that work?",
          type: "text",
          helpText:
            "Name the third party if one runs it. If it is some other arrangement, describe it — a shared service between campuses, a consortium, a faculty-run programme.",
          order: 3.1,
          visible: true,
          indent: true,
          showIf: { field: "ia_ea_operated_by", value: ["A third party", "Other"] },
        },
        {
          name: "ia_ea_software",
          label: "What software delivers it?",
          type: "text",
          order: 4,
          visible: true,
          helpText: "The platform students actually receive their materials through.",
        },
        {
          name: "ia_ea_collection_model",
          label: "Do you collect the sales, or do they flow through student fees?",
          type: "select",
          order: 5,
          visible: true,
          options: ["We collect the sales", "It flows through student fees"],
          helpText: "Who takes the student's money. This is about the mechanism, not the amount.",
          allowOther: true,
        },
        {
          /*
            Replaced by the type-and-Enter box on the question above, which
            stores what the store typed as the answer itself. Kept hidden so
            any 2025 value already in this column is still readable.
          */
          name: "ia_ea_collection_model_other",
          label: "Describe how the money reaches you",
          type: "text",
          order: 5.1,
          visible: false,
          indent: true,
        },
        {
          name: "ia_ea_institution_amount",
          label: "How much did the institution collect?",
          type: "currency",
          order: 6,
          visible: true,
          helpText: "The programme's value where the money never came through your books. Asked here because it is not your revenue in any ordinary sense, and your other sections deliberately exclude it.",
          showIf: { field: "ia_ea_collection_model", value: "It flows through student fees" },
        },
        {
          name: "ia_ea_count_as_revenue",
          label: "For comparison, should we count this as part of your revenue?",
          type: "boolean",
          order: 7,
          visible: true,
          helpText: "Your call, not ours. Counting it shows the scale of what you handle; leaving it out compares your books with everyone else's. We will use whichever you choose and say which we used.",
          showIf: { field: "ia_ea_collection_model", value: "It flows through student fees" },
        },
        {
          /*
            Asked here, in the section that already establishes what the
            programme is — three sections away from the sales figures, because
            the two numbers are about different things and stores kept reading
            them as the same question asked twice.
          */
          name: "ia_ea_booked_outside_pct",
          label: "How much of the programme is booked through something that is not the bookstore?",
          type: "percentage",
          helpText:
            "By value. If every title flows through your system, this is zero. If the institution buys direct from a publisher for some courses, that share belongs here.",
          order: 8,
          visible: true,
          suffix: "%",
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
    /*
      Total store space is the sum of its parts, not a fifth number to type.

      It was asked AND broken down, which invites the two to disagree — and the
      old help text made that certain by saying "do not include office and
      storage" above a breakdown containing office and storage. Now the parts
      are the question and this is the arithmetic.
    */
    case "total_square_footage":
      return (
        num("sqft_salesfloor") + num("sqft_storage") + num("sqft_office") + num("sqft_other")
      );

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
