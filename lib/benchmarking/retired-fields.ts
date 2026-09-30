/**
 * Columns the FY2026 rebuild stopped writing.
 *
 * ⛔ Not the same as "hidden in the field config". Several hidden columns are
 * still very much live, written by a component instead of a config field: the
 * square footage family is rolled up from the per-location editor, and the wage
 * and benefit columns come from the pay grid. Judging by visibility alone would
 * have retired all of those and broken sales per square foot.
 *
 * These are the ones NOTHING writes any more, because the category tables
 * replaced them. They are kept as columns so a pre-2026 submission still reads,
 * and listed here so nothing treats them as this year's answers.
 */
export const RETIRED_FIELDS = new Set<string>([
  // Replaced by benchmarking_category_lines.
  "total_gross_sales_instore",
  "total_online_sales",
  "total_cogs",
  "fye_inventory_value",
  "sales_course_supplies",
  "sales_course_supplies_online",
  "sales_general_books",
  "sales_technology",
  "sales_stationary",
  "sales_apparel",
  "sales_apparel_imprint",
  "sales_apparel_non_imprint",
  "sales_gifts_drinkware",
  "sales_gifts_imprint",
  "sales_gifts_non_imprint",
  "sales_custom_merch",
  "sales_food_beverage",
  "sales_course_materials",
  "sales_course_materials_online",
  "cm_print_new_total",
  "cm_print_new_online",
  "cm_print_used_total",
  "cm_print_used_online",
  "cm_custom_courseware_total",
  "cm_custom_courseware_online",
  "cm_rentals_total",
  "cm_rentals_online",
  "cm_digital_total",
  "cm_digital_online",
  "cm_inclusive_access_total",
  "cm_inclusive_access_online",
  "cm_course_packs_total",
  "cm_course_packs_online",
  "cm_other_total",
  "cm_other_online",

  // Replaced by Other Income rows and the §10 questions.
  "ia_revenue",
  "other_non_retail_revenue",
  "other_non_retail_description",

  // Derived in the review rather than asked.
  "net_profit",

  // Replaced by shrinkage in dollars.
  "shrink_textbooks",
  "shrink_general_merch",
  "shrink_percentage",

  // Replaced by per-person years in the team list.
  "manager_years_current_position",
  "manager_years_in_industry",

  // Replaced by counting the location rows.
  "num_store_locations",

  // Replaced by the competitors table.
  "competing_stores_count",
  "competing_stores_notes",

  // Replaced by wages_student, which Campus Contributions reads directly.
  "contrib_student_wages",

  // Replaced by the per-location hours grid.
  "weekday_hours_open",
  "weekday_hours_close",
  "saturday_hours_open",
  "saturday_hours_close",
  "sunday_hours_open",
  "sunday_hours_close",
  "hours_vary_seasonally",
]);
