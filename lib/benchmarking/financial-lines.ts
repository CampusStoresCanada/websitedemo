/**
 * The lines the income statement in §8 is built from.
 *
 * Kept here rather than in the review component because two places need the
 * same list — the Expenses section shows a running total as the store types,
 * and the review adds the same lines up again. Two copies of a list of expense
 * keys is two chances for a total to disagree with the statement under it, and
 * the store would be right to trust neither.
 */

import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";

export interface StatementLine {
  /** Column on `benchmarking`. */
  name: string;
  label: string;
  /** Section id the field is answered in, for "click to go and fix it". */
  section: string;
}

export const NAMED_EXPENSE_LINES: StatementLine[] = [
  { name: "expense_hr", label: "Salaries, wages and benefits", section: "staffing" },
  { name: "expense_rent_maintenance", label: "Rent, maintenance and repairs", section: "expenses" },
  { name: "expense_utilities", label: "Utilities", section: "expenses" },
  { name: "expense_advertising", label: "Advertising and promotion", section: "expenses" },
  { name: "expense_telephone", label: "Telephone and communications", section: "expenses" },
  { name: "expense_store_supplies", label: "Store and business supplies", section: "expenses" },
  { name: "expense_it", label: "Information technology", section: "expenses" },
  { name: "expense_postage", label: "Postage and shipping", section: "expenses" },
  { name: "expense_depreciation", label: "Depreciation and amortization", section: "expenses" },
  { name: "expense_professional_services", label: "Professional services", section: "expenses" },
  { name: "expense_education_travel", label: "Education and travel", section: "expenses" },
  { name: "expense_insurance", label: "Business insurance", section: "expenses" },
  { name: "expense_card_fees", label: "Credit and debit card fees", section: "expenses" },
  { name: "expense_university_admin", label: "University administrative charge", section: "expenses" },
  { name: "marketing_spend", label: "Marketing", section: "expenses" },
];

/**
 * Campus contribution lines.
 *
 * ⛔ `expense_university_admin` is deliberately in both this list and the
 * expense list. It is one answer, entered once, that is genuinely both an
 * operating cost and money going to the institution — so it is counted once in
 * each total and never added to itself.
 */
export const CONTRIBUTION_LINES: StatementLine[] = [
  { name: "contrib_discounts", label: "Discounts to students", section: "campus_contributions" },
  { name: "contrib_rent_to_institution", label: "Rent to the institution", section: "campus_contributions" },
  { name: "contrib_commissions", label: "Commissions", section: "campus_contributions" },
  { name: "contrib_donations", label: "Donations", section: "campus_contributions" },
  { name: "contrib_scholarships", label: "Scholarships and bursaries", section: "campus_contributions" },
  { name: "contrib_bad_debt", label: "Bad debt", section: "campus_contributions" },
  { name: "contrib_rebates", label: "Rebates returned", section: "campus_contributions" },
  { name: "contrib_other_agreements", label: "Other campus agreements", section: "campus_contributions" },
  { name: "contrib_local_marketing", label: "Local marketing", section: "campus_contributions" },
  /*
    Read from the Staffing answer, not from a contribution field of its own.
    Both existed, both were asked, and nothing connected them — so a store that
    answered honestly in §6 was then asked for the same number again, and the
    two were free to disagree.
  */
  { name: "wages_student", label: "Student wages", section: "staffing" },
  { name: "expense_university_admin", label: "University administrative charge", section: "expenses" },
];

export type CategoryAmountKey =
  | "retailSales"
  | "onlineSales"
  | "inventoryOpen"
  | "inventoryClose";

export function sumCategories(
  categories: SurveyCategory[],
  key: CategoryAmountKey,
): number {
  return categories.reduce(
    (total, category) =>
      total +
      category.lines.reduce((sum, line) => sum + ((line[key] as number | null) ?? 0), 0),
    0,
  );
}

/** Sales across both channels, which is what every ratio is a share of. */
export function categorySalesTotal(categories: SurveyCategory[]): number {
  return sumCategories(categories, "retailSales") + sumCategories(categories, "onlineSales");
}

/**
 * Gross margin from the margin each category was given, not from a separate
 * cost of sales figure. Asking for both invites the two to disagree, and a
 * per-category margin is the one a merchandise manager can act on.
 */
export function grossMarginFromCategories(categories: SurveyCategory[]): number {
  return categories.reduce(
    (total, category) =>
      total +
      category.lines.reduce((sum, line) => {
        const sales = (line.retailSales ?? 0) + (line.onlineSales ?? 0);
        return sum + (line.grossMarginPct !== null ? sales * (line.grossMarginPct / 100) : 0);
      }, 0),
    0,
  );
}

export function sumFields(
  formData: Record<string, unknown>,
  lines: StatementLine[],
): number {
  return lines.reduce((total, line) => {
    const value = formData[line.name];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}
