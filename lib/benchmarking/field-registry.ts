/**
 * What may be saved, and what shape it has to be in.
 *
 * ⛔ Plain module, not "use server". It used to live inside the save action,
 * which meant nothing could import it — not the field config it has to agree
 * with, and not a test. The two drifted five times in one rebuild: a store
 * would pick a perfectly valid option from a dropdown and get a validation
 * error for it, because the list on screen and the list that accepts the answer
 * were maintained separately.
 *
 * lib/benchmarking/__tests__/field-registry.test.ts now fails if they diverge.
 */

export type FieldType =
  | "currency"     // stored as integer cents → displayed as $x.xx
  | "number"       // any numeric (integer or decimal)
  | "integer"      // whole numbers only
  | "percentage"   // 0–100 stored as number
  | "text"         // free-text (max 500 chars)
  | "text_long"    // longer text (max 2000 chars)
  | "select"       // must match one of allowed values
  | "multiselect"  // text[] column — zero or more values, stored as an array
  | "boolean";     // true / false / null

export interface FieldDef {
  type: FieldType;
  /** For select fields: the allowed values */
  options?: string[];
  /**
   * multiselect only: the options are a prompt, not a closed set.
   *
   * Every one of these lists already has a tail of things stores added
   * themselves — "Gown Rentals for Graduation Photography", "Lottery ticket
   * sales". Enforcing membership would reject a store's own 2025 answer the
   * next time they touched the row, and would teach them that the honest
   * answer is unwelcome.
   */
  allowOther?: boolean;
  /** Max length for text fields (defaults to 500) */
  maxLength?: number;
  /**
   * Shape a text value must match.
   *
   * Exists for the id fields that point at another table. Without it a typo
   * reaches Postgres as a malformed uuid and comes back as a 500 the reader
   * cannot act on, instead of a sentence telling them what went wrong.
   */
  pattern?: { test: RegExp; message: string };
  /** Min numeric value (inclusive) */
  min?: number;
  /** Max numeric value (inclusive) */
  max?: number;
}

// ─────────────────────────────────────────────────────────────────
// Field Allowlist + Type Registry
// Every editable survey field MUST be listed here.
// Fields NOT listed are blocked from writes.
// ─────────────────────────────────────────────────────────────────

export const FIELD_REGISTRY: Record<string, FieldDef> = {
  // ── Who to phone about these figures (brief, Institution Profile) ──
  //
  // Editable by the store, unlike respondent_user_id which records who pressed
  // submit and is system-only. The person who compiled the numbers is often not
  // the account holder, and a reviewer ringing the wrong desk in November is how
  // a flag goes unanswered.
  respondent_name:         { type: "text", maxLength: 120 },
  respondent_title:        { type: "text", maxLength: 120 },
  respondent_email:        { type: "text", maxLength: 200 },
  respondent_phone:        { type: "text", maxLength: 60 },

  // ── Section 1: Institution Profile ──
  store_name:              { type: "text" },
  institution_type:        { type: "select", options: ["University", "College", "Polytechnic", "CEGEP"] },
  enrollment_fte:          { type: "integer", min: 0, max: 500000 },
  num_store_locations:     { type: "integer", min: 0, max: 100 },
  total_square_footage:    { type: "integer", min: 0, max: 1000000 },
  operations_mandate:      { type: "select", options: ["Cost Recovery", "For-profit", "Not-for-profit"] },
  is_semester_based:       { type: "boolean" },
  fiscal_year_end_month:   { type: "select", options: ["January","February","March","April","May","June","July","August","September","October","November","December"] },
  fiscal_year_end_day:     { type: "select", options: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")) },
  inventory_count_style:   { type: "select", options: ["Annual", "Bi-annual", "Cycle Counts", "Other"] },
  inventory_count_style_other: { type: "text", maxLength: 300 },
  does_book_buyback:       { type: "boolean" },
  sqft_salesfloor:         { type: "integer", min: 0, max: 500000 },
  sqft_storage:            { type: "integer", min: 0, max: 500000 },
  sqft_office:             { type: "integer", min: 0, max: 500000 },
  sqft_other:              { type: "integer", min: 0, max: 500000 },

  // ── Section 2: Sales Revenue ──
  total_gross_sales_instore: { type: "currency", min: 0 },
  total_online_sales:        { type: "currency", min: 0 },
  ia_revenue:                { type: "currency", min: 0 },
  other_non_retail_revenue:  { type: "currency", min: 0 },
  other_non_retail_description: { type: "text_long" },

  // ── Section 3: Financial Metrics ──
  total_cogs:              { type: "currency", min: 0 },
  expense_hr:              { type: "currency", min: 0 },
  expense_rent_maintenance:{ type: "currency", min: 0 },
  net_profit:              { type: "currency" }, // can be negative (loss)
  marketing_spend:         { type: "currency", min: 0 },
  central_funding:         { type: "currency", min: 0 },

  // ── Section 4: Staffing ──
  fulltime_employees:              { type: "number", min: 0, max: 10000 },
  parttime_fte_offpeak:            { type: "number", min: 0, max: 10000 },
  student_fte_average:             { type: "number", min: 0, max: 10000 },
  manager_years_current_position:  { type: "number", min: 0, max: 60 },
  manager_years_in_industry:       { type: "number", min: 0, max: 60 },

  // ── Section 5: Course Materials Breakdown ──
  cm_print_new_total:        { type: "currency", min: 0 },
  cm_print_new_online:       { type: "currency", min: 0 },
  cm_print_used_total:       { type: "currency", min: 0 },
  cm_print_used_online:      { type: "currency", min: 0 },
  cm_custom_courseware_total: { type: "currency", min: 0 },
  cm_custom_courseware_online:{ type: "currency", min: 0 },
  cm_rentals_total:          { type: "currency", min: 0 },
  cm_rentals_online:         { type: "currency", min: 0 },
  cm_digital_total:          { type: "currency", min: 0 },
  cm_digital_online:         { type: "currency", min: 0 },
  cm_inclusive_access_total:  { type: "currency", min: 0 },
  cm_inclusive_access_online: { type: "currency", min: 0 },
  cm_course_packs_total:     { type: "currency", min: 0 },
  cm_course_packs_online:    { type: "currency", min: 0 },
  cm_other_total:            { type: "currency", min: 0 },
  cm_other_online:           { type: "currency", min: 0 },

  // ── Section 6: General Merchandise ──
  sales_course_supplies:        { type: "currency", min: 0 },
  sales_course_supplies_online: { type: "currency", min: 0 },
  sales_general_books:          { type: "currency", min: 0 },
  sales_technology:             { type: "currency", min: 0 },
  sales_stationary:             { type: "currency", min: 0 },
  sales_apparel:                { type: "currency", min: 0 },
  sales_apparel_imprint:        { type: "currency", min: 0 },
  sales_apparel_non_imprint:    { type: "currency", min: 0 },
  sales_gifts_drinkware:        { type: "currency", min: 0 },
  sales_gifts_imprint:          { type: "currency", min: 0 },
  sales_gifts_non_imprint:      { type: "currency", min: 0 },
  sales_custom_merch:           { type: "currency", min: 0 },
  sales_food_beverage:          { type: "currency", min: 0 },

  // ── Section 7: Technology & Systems ──
  // Select all that apply: a store mid-migration runs two, and the columns are
  // text[] as of the FY2026 rebuild. allowOther keeps the type-and-Enter escape
  // open, so a system we have not heard of is recorded rather than refused.
  pos_system:              { type: "multiselect", allowOther: true, options: ["Carleton Technologies - Bookware", "PrismRBS", "Lightspeed", "NetSuite", "MBS", "Ratex", "Waterloo Information Systems (WISL)", "Built in house"] },
  ebook_delivery_system:   { type: "multiselect", allowOther: true, options: ["CEI", "VitalSource", "Kivuto", "Built in house"] },
  student_info_system:     { type: "multiselect", allowOther: true, options: ["Banner", "PeopleSoft", "Colleague", "Workday Student", "Omnivox", "Salesforce", "Built by the institution"] },
  lms_system:              { type: "multiselect", allowOther: true, options: ["D2L/Brightspace", "Moodle", "Canvas", "Blackboard", "LEA"] },
  payment_options:         { type: "multiselect", allowOther: true, options: ["Cash", "Debit", "Credit", "Student account", "Departmental charge", "Financial aid or bursary", "Campus card", "Tap to pay on mobile", "Buy now, pay later", "Gift card"] },
  social_media_platforms:  { type: "multiselect", allowOther: true, options: ["Instagram", "Facebook", "TikTok", "X", "LinkedIn", "YouTube", "Snapchat", "Threads", "Reddit", "Discord"] },
  social_media_frequency:  { type: "select", options: ["Several times a day", "Daily", "A few times a week", "Weekly", "A few times a month", "Less than monthly"] },
  social_media_run_by:     { type: "select", options: ["Store staff, as part of their job", "A student employee", "A dedicated marketing person", "The institution's marketing department", "An agency", "Nobody in particular"] },
  services_offered:        { type: "multiselect", allowOther: true, options: ["Sponsorships", "Transit or Parking Pass Sales", "Locker Sales", "Print / Photocopy Service", "Campus Card Services", "Post Office", "Student Mail Services", "Campus Mail"] },
  shopping_services:       { type: "multiselect", allowOther: true, options: ["In-Store Pick-up", "Ship from Store", "Order on Web", "Custom Orders", "Return to Store", "Special Orders", "Customer Service Kiosk", "Graduation Regalia", "Residence Delivery", "Locker Pick-up", "Competitive Price Guarantee", "Personal Shopper"] },
  store_in_stores:         { type: "text_long" },
  physical_inventory_schedule: { type: "text" },

  // ── Section 8: Store Operations & New KPIs ──
  weekday_hours_open:      { type: "text", maxLength: 20 },
  weekday_hours_close:     { type: "text", maxLength: 20 },
  saturday_hours_open:     { type: "text", maxLength: 20 },
  saturday_hours_close:    { type: "text", maxLength: 20 },
  sunday_hours_open:       { type: "text", maxLength: 20 },
  sunday_hours_close:      { type: "text", maxLength: 20 },
  hours_vary_seasonally:   { type: "boolean" },
  shrink_textbooks:        { type: "percentage" },
  shrink_general_merch:    { type: "percentage" },
  fye_inventory_value:     { type: "currency", min: 0 },
  total_transaction_count: { type: "integer", min: 0, max: 50000000 },
  tracks_adoptions:        { type: "boolean" },
  total_course_sections:   { type: "integer", min: 0, max: 50000 },
  adoptions_by_deadline:   { type: "integer", min: 0, max: 50000 },
  /*
    Kept identical to the field config's list, which is the one the reader sees.
    They drifted, and the result was a store picking a perfectly valid option
    from the dropdown and getting a validation error for it.
  */
  adoption_deadline_window:{ type: "select", options: ["More than 12 weeks before term", "8 to 12 weeks before term", "4 to 8 weeks before term", "Less than 4 weeks before term", "We do not set one"] },

  // ── How the IA/EA programme runs (Store Operations) ──
  //
  // Registered rather than left to resolveConfiguredFieldDef, which exists for
  // questions added through the editor. These ship in DEFAULT_FIELD_CONFIG, so
  // they belong here and save without the extra config lookup.
  ia_ea_program_type:      { type: "select", options: ["Inclusive Access", "Equitable Access", "Both", "Neither", "Other"] },
  ia_ea_program_type_other:{ type: "text", maxLength: 200 },
  ia_ea_enrolment_model:   { type: "select", options: ["Opt-in", "Opt-out", "Other"] },
  ia_ea_enrolment_model_other: { type: "text", maxLength: 200 },
  ia_ea_collection_model:  { type: "select", options: ["We collect the sales", "It flows through student fees", "Other"] },
  ia_ea_collection_model_other:{ type: "text", maxLength: 200 },

  // ── §5 Campus Contributions ──
  contrib_discounts:            { type: "currency", min: 0 },
  contrib_rent_to_institution:  { type: "currency", min: 0 },
  contrib_commissions:          { type: "currency", min: 0 },
  contrib_donations:            { type: "currency", min: 0 },
  contrib_scholarships:         { type: "currency", min: 0 },
  contrib_bad_debt:             { type: "currency", min: 0 },
  contrib_rebates:              { type: "currency", min: 0 },
  contrib_other_agreements:     { type: "currency", min: 0 },
  contrib_local_marketing:      { type: "currency", min: 0 },
  contrib_student_wages:        { type: "currency", min: 0 },

  // ── §6 Staffing: wages by employment type, feeding §7 ──
  wages_full_time:              { type: "currency", min: 0 },
  wages_part_time:              { type: "currency", min: 0 },
  wages_student:                { type: "currency", min: 0 },
  wages_seasonal:               { type: "currency", min: 0 },
  seasonal_employees:           { type: "number", min: 0, max: 10000 },

  // ── §7 Expenses ──
  expense_advertising:          { type: "currency", min: 0 },
  expense_telephone:            { type: "currency", min: 0 },
  expense_store_supplies:       { type: "currency", min: 0 },
  expense_it:                   { type: "currency", min: 0 },
  expense_postage:              { type: "currency", min: 0 },
  expense_depreciation:         { type: "currency", min: 0 },
  expense_professional_services:{ type: "currency", min: 0 },
  expense_education_travel:     { type: "currency", min: 0 },
  expense_insurance:            { type: "currency", min: 0 },
  expense_card_fees:            { type: "currency", min: 0 },
  expense_university_admin:     { type: "currency", min: 0 },
  expense_utilities:            { type: "currency", min: 0 },
  // Dollars, not percentages — a percentage cannot be reconciled to a P&L.
  shrink_at_cost:               { type: "currency" },
  shrink_at_retail:             { type: "currency" },

  // ── §1 Their market, §3 sell-through, §10 the share booked elsewhere ──
  competing_stores_count:       { type: "integer", min: 0, max: 200 },
  competing_stores_notes:       { type: "text", maxLength: 500 },
  // Physical course materials only. Digital and IA have no comparable figure.
  cm_sell_through_pct:          { type: "percentage", min: 0, max: 100 },
  ia_ea_booked_outside_pct:     { type: "percentage", min: 0, max: 100 },

  // The person behind "store staff run it" — see components/.../SocialOwner.
  social_media_run_by_contact_id: {
    type: "text",
    maxLength: 36,
    pattern: {
      test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      message: "That is not one of your store's people.",
    },
  },

  // ── §6 Benefits, told apart from wages ──
  benefits_paid_by:             { type: "select", options: ["The store pays them", "The institution pays them centrally", "Split between the store and the institution", "Staff are not eligible for benefits"] },
  benefits_total:               { type: "currency", min: 0 },
  benefits_full_time:           { type: "currency", min: 0 },
  benefits_part_time:           { type: "currency", min: 0 },
  benefits_student:             { type: "currency", min: 0 },
  benefits_seasonal:            { type: "currency", min: 0 },
  student_wages_is_contribution:{ type: "boolean" },

  // ── §10 IA/EA ──
  ia_ea_operated_by:            { type: "select", options: ["In house", "The institution", "A third party", "Other"] },
  ia_ea_operated_by_other:      { type: "text", maxLength: 200 },
  ia_ea_software:               { type: "text", maxLength: 200 },
  ia_ea_institution_amount:     { type: "currency", min: 0 },
  ia_ea_count_as_revenue:       { type: "boolean" },
};
