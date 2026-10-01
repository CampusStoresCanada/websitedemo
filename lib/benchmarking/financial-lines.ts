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
  /**
   * A boolean column that decides whether this line counts at all.
   *
   * Student wages are the case: most stores count employing students as giving
   * back, some treat it as ordinary staffing because the work would be done
   * either way, and it is not our call to make for them.
   */
  onlyIf?: string;
}

export const NAMED_EXPENSE_LINES: StatementLine[] = [
  { name: "expense_hr", label: "Salaries and wages", section: "staffing" },
  /*
    Only what the STORE pays toward benefits. Where the institution carries them
    centrally these are blank, and that blank is the answer: it is why two stores
    with the same payroll show different staff costs, and the old combined "wages
    and benefits" figure hid it completely.

    ⛔ benefits_total is the fallback for a store that only has one number, and
    is counted ONLY when the per-type rows are empty. Counting both would double
    the benefit cost for anyone who filled in the grid.
  */
  { name: "benefits_full_time", label: "Benefits, full-time", section: "staffing" },
  { name: "benefits_part_time", label: "Benefits, part-time", section: "staffing" },
  { name: "benefits_student", label: "Benefits, student", section: "staffing" },
  { name: "benefits_seasonal", label: "Benefits, seasonal", section: "staffing" },
  {
    name: "benefits_total",
    label: "Staff benefits",
    section: "staffing",
    onlyIf: "__no_benefit_rows",
  },
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
  {
    name: "wages_student",
    label: "Student wages",
    section: "staffing",
    // Counted only if the store said it counts. See CONTRIBUTION_LINES below.
    onlyIf: "student_wages_is_contribution",
  },
  { name: "expense_university_admin", label: "University administrative charge", section: "expenses" },
];

export type CategoryAmountKey =
  | "retailSales"
  | "onlineSales"
  | "inventoryOpen"
  | "inventoryClose";

/**
 * The lines a category is actually reporting on.
 *
 * ⛔ A split category keeps its whole-department row in the table, so summing
 * every line counts a properly split department twice. The form shows one set
 * or the other; everything that adds them up has to agree with what the form
 * showed, or the review screen and the report describe different stores.
 */
export function linesInUse(category: SurveyCategory) {
  return category.splitBySubcategory
    ? category.lines.filter((l) => l.subcategory !== null)
    : category.lines.filter((l) => l.subcategory === null);
}

export function sumCategories(
  categories: SurveyCategory[],
  key: CategoryAmountKey,
): number {
  return categories.reduce(
    (total, category) =>
      total +
      linesInUse(category).reduce((sum, line) => sum + ((line[key] as number | null) ?? 0), 0),
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
      linesInUse(category).reduce((sum, line) => {
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
  return countedLines(formData, lines).reduce((total, line) => {
    const value = formData[line.name];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

/**
 * The lines that actually count, once the store's own switches are applied.
 *
 * Used by the total AND by whatever displays the lines, so a line can never be
 * shown in a list whose total excludes it.
 */
const BENEFIT_ROWS = [
  "benefits_full_time",
  "benefits_part_time",
  "benefits_student",
  "benefits_seasonal",
];

export function countedLines(
  formData: Record<string, unknown>,
  lines: StatementLine[],
): StatementLine[] {
  /*
    The one derived switch: whether the store used the per-type benefit grid.
    A store that filled the grid must not also have its single fallback figure
    added on top, or its benefit cost doubles.
  */
  const hasRows = BENEFIT_ROWS.some((k) => typeof formData[k] === "number");
  const derived: Record<string, unknown> = {
    ...formData,
    __no_benefit_rows: !hasRows,
  };
  return lines.filter((line) => !line.onlyIf || derived[line.onlyIf] !== false);
}


// ─────────────────────────────────────────────────────────────────
// The statement, derived once
// ─────────────────────────────────────────────────────────────────

/**
 * Everything the income statement needs, from the parts a store actually gave.
 *
 * ⛔ ONE derivation, used by the review screen the store reads and by the
 * metrics the report publishes. They were separate, and the report's half still
 * read the flat columns the category grid replaced — so an FY2026 submission
 * would have produced a full statement on screen and a page of nulls in the
 * report. A store cannot be shown one set of figures and compared on another.
 */
export interface StatementParts {
  gmCategories: SurveyCategory[];
  cmCategories: SurveyCategory[];
  otherIncome: {
    amount: number | null;
    countsAsIncome: boolean;
    directCost: number | null;
    directCostInExpenses: boolean;
  }[];
  otherExpenses: { amount: number | null }[];
  /** The `benchmarking` row, for the fields that are still plain columns. */
  formData: Record<string, unknown>;
}

export interface Statement {
  merchandiseRetail: number;
  merchandiseOnline: number;
  courseMaterialsRetail: number;
  courseMaterialsOnline: number;
  onlineSales: number;
  otherIncome: number;
  centralFunding: number;
  totalRevenue: number | null;
  grossMargin: number | null;
  costOfSales: number | null;
  openingInventory: number | null;
  closingInventory: number | null;
  operatingExpenses: number;
  operatingIncome: number | null;
  campusContribution: number;
  /**
   * Whether this was derived from category rows at all.
   *
   * False for every pre-2026 submission, which has no category data and must
   * fall back to the flat columns it was filed against. Year-over-year then
   * still works: the two years disagree about where the number came FROM, not
   * about what the number means.
   */
  fromCategories: boolean;
}

function orNull(value: number, present: boolean): number | null {
  return present ? value : null;
}

export function deriveStatement(parts: StatementParts): Statement {
  const { gmCategories, cmCategories, otherIncome, otherExpenses, formData } = parts;

  const categories = [...gmCategories, ...cmCategories];
  const fromCategories = categories.some((c) => c.lines.length > 0);

  const merchandiseRetail = sumCategories(gmCategories, "retailSales");
  const merchandiseOnline = sumCategories(gmCategories, "onlineSales");
  const courseMaterialsRetail = sumCategories(cmCategories, "retailSales");
  const courseMaterialsOnline = sumCategories(cmCategories, "onlineSales");

  const income = otherIncome.reduce(
    (sum, row) => sum + (row.countsAsIncome ? (row.amount ?? 0) : 0),
    0,
  );
  const funding = typeof formData.central_funding === "number" ? formData.central_funding : 0;

  const totalRevenue =
    merchandiseRetail +
    merchandiseOnline +
    courseMaterialsRetail +
    courseMaterialsOnline +
    income +
    funding;

  const marginDollars =
    grossMarginFromCategories(gmCategories) + grossMarginFromCategories(cmCategories);

  const openingInventory =
    sumCategories(gmCategories, "inventoryOpen") + sumCategories(cmCategories, "inventoryOpen");
  const closingInventory =
    sumCategories(gmCategories, "inventoryClose") + sumCategories(cmCategories, "inventoryClose");

  // Only the service costs a store said are NOT already in its expense lines.
  const uncountedDirectCosts = otherIncome.reduce(
    (sum, row) => sum + (!row.directCostInExpenses ? (row.directCost ?? 0) : 0),
    0,
  );

  const operatingExpenses =
    sumFields(formData, NAMED_EXPENSE_LINES) +
    otherExpenses.reduce((sum, row) => sum + (row.amount ?? 0), 0) +
    uncountedDirectCosts;

  const grossMargin = orNull(marginDollars, fromCategories && marginDollars > 0);

  return {
    merchandiseRetail,
    merchandiseOnline,
    courseMaterialsRetail,
    courseMaterialsOnline,
    onlineSales: merchandiseOnline + courseMaterialsOnline,
    otherIncome: income,
    centralFunding: funding,
    totalRevenue: orNull(totalRevenue, fromCategories || totalRevenue > 0),
    grossMargin,
    // Implied, not asked. Asking for cost of sales AND a margin per category is
    // how a total and its parts end up disagreeing.
    costOfSales: grossMargin === null ? null : totalRevenue - grossMargin,
    openingInventory: orNull(openingInventory, fromCategories),
    closingInventory: orNull(closingInventory, fromCategories),
    operatingExpenses,
    operatingIncome: grossMargin === null ? null : grossMargin - operatingExpenses,
    campusContribution: sumFields(formData, CONTRIBUTION_LINES),
    fromCategories,
  };
}


/**
 * Figures sitting on a whole-department row of a category that has been split.
 *
 * Ticking "break this into subcategories" leaves the department's own row in
 * place with its figures on it, and from that moment nothing counts them. A
 * store that typed 420,000 against Apparel and then split it watches its
 * largest category silently become zero, with the number still sitting in the
 * database looking fine.
 *
 * ⛔ Reported, never moved. Splitting 420,000 across six subcategories is a
 * judgement only the store can make, and guessing it would be writing an
 * interpretation into their submission.
 */
export function strandedBySplit(
  categories: SurveyCategory[],
): { department: string; amount: number }[] {
  return categories
    .filter((c) => c.splitBySubcategory)
    .map((c) => {
      const whole = c.lines.filter((l) => l.subcategory === null);
      const amount = whole.reduce(
        (sum, l) => sum + (l.retailSales ?? 0) + (l.onlineSales ?? 0),
        0,
      );
      return { department: c.department, amount };
    })
    .filter((c) => c.amount > 0);
}


/**
 * Human names for the CALCULATED lines of the statement.
 *
 * ⛔ Here, not in the component that renders them. A store overwriting one of
 * these writes a note against the line key, and the note is read somewhere
 * else entirely — a DM to the committee lead, the Explanations queue, the
 * appendix. fieldLabel() walks the field config, which these are not in, so it
 * fell through to the raw key and sent "explanation pending on gm_online".
 */
export const STATEMENT_LINE_LABELS: Record<string, string> = {
  gm_retail: "General merchandise, retail sales",
  gm_online: "General merchandise, online sales",
  cm_retail: "Course materials, retail sales",
  cm_online: "Course materials, online sales",
  other_income: "Other income",
  total_revenue: "Total revenue",
  gross_margin: "Gross margin",
  inventory_open: "Opening inventory, at cost",
  inventory_close: "Closing inventory, at cost",
  operating_expenses: "Total operating expenses",
  operating_income: "Operating income",
  campus_contribution: "Total campus contribution",
};
