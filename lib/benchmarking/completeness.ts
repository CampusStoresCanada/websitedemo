import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";

/**
 * What a store loses by leaving a figure blank, and the very few blanks we
 * refuse to accept at all.
 *
 * Two mechanisms, deliberately, because campus stores vary enormously in what
 * they can produce. A store whose institution carries utilities centrally has
 * no utilities figure, and a required field would force it to type 0 — a lie
 * the data cannot tell apart from "we spent nothing".
 *
 * So: block on the handful of answers without which the submission cannot be
 * READ at all, and for everything else say plainly what the blank costs. A red
 * asterisk tells a store it must; this tells it why, which is the only thing
 * that makes someone go and find a number.
 *
 * ⛔ Adding to REQUIRED is a decision to lose submissions. Every blocking field
 * is a place a store can give up, and a store that gives up files nothing at
 * all rather than filing the rest.
 */

/**
 * The blanks that make a submission uninterpretable.
 *
 * Each one is enforced in the field config as `required: true`; this list is
 * the reasoning, kept where it can be read and argued with.
 *
 *   enrollment_fte        The denominator of every per-student figure in the
 *                         report, and the number that sets the store's CSC
 *                         rate. Without it the row cannot be put in a size
 *                         band, which is one of the four comparisons promised
 *                         on the intro page. Every institution already reports
 *                         this to its province.
 *
 *   fiscal_year_end_*     Without the year end, every dollar in the submission
 *                         is uninterpretable. Consecutive years cannot be
 *                         paired for inventory turns, a figure cannot be read
 *                         as including rush or not, and an April year-end store
 *                         cannot be compared with a December one. It is two
 *                         dropdowns and every store knows the answer.
 *
 *   institution_type      One of the four comparisons is "stores of your type".
 *                         Without it the row cannot be grouped.
 *
 *   operations_mandate    Decides what a margin MEANS. A cost-recovery store at
 *                         2% net is performing; a for-profit store at 2% is in
 *                         trouble. Comparing them without knowing which is the
 *                         most misleading thing this report could do.
 *
 *   fulltime_employees    Staffing cost per FTE is a headline figure. Zero is a
 *                         valid answer for a fully student-staffed shop, so the
 *                         requirement is that they tell us, not that it is
 *                         above zero.
 */
export const REQUIRED_FIELDS = [
  "enrollment_fte",
  "fiscal_year_end_month",
  "fiscal_year_end_day",
  "institution_type",
  "operations_mandate",
  "fulltime_employees",
] as const;

export interface Gap {
  /** Field or list the store has left empty. */
  key: string;
  /** What they would have to fill in, in their words. */
  label: string;
  /** Section to send them to. */
  section: string;
  /** What the blank costs them, said as a consequence rather than a rule. */
  cost: string;
}

/**
 * Blanks worth naming, and what each one actually costs the store.
 *
 * Only figures that silently remove the store from something it would otherwise
 * receive. A blank that costs nothing is not worth a line here: a list of every
 * empty box is a list nobody reads.
 */
const WATCHED: Gap[] = [
  {
    key: "expense_hr",
    label: "Salaries and wages",
    section: "expenses",
    cost: "Staff cost as a share of sales is the expense figure stores ask for most. Leave it blank and you see everyone else's and not your own.",
  },
  {
    key: "expense_rent_maintenance",
    label: "Rent, maintenance and repairs",
    section: "expenses",
    cost: "Occupancy cost per square foot drops out, and so does your position in the expense breakdown.",
  },
  {
    key: "shrink_at_cost",
    label: "Shrinkage at cost",
    section: "expenses",
    cost: "No shrink comparison. This is one of the few figures where stores genuinely do not know whether they are unusual.",
  },
  {
    key: "total_transaction_count",
    label: "Total transactions",
    section: "institution_profile",
    cost: "No average basket, which is the figure most often asked for after margin.",
  },
  {
    key: "contrib_discounts",
    label: "Discounts given to students",
    section: "campus_contributions",
    cost: "Usually the largest single way a store subsidises its campus. Without it your total contribution understates what you give back, and that total is what a vice-president asks for.",
  },
  {
    key: "central_funding",
    label: "Funding from the institution",
    section: "other_income",
    cost: "A store carrying a subsidy and one standing on its own look identical without this, which flatters the subsidised store and penalises the other.",
  },
  {
    key: "cm_sell_through_pct",
    label: "Sell-through on physical course materials",
    section: "course_materials",
    cost: "No sell-through comparison, which is the clearest read on whether you are over-ordering.",
  },
  {
    key: "pos_system",
    label: "Point of sale",
    section: "technology_systems",
    cost: "You drop out of “what do stores like us run”, which is the most asked question on the member forum.",
  },
];

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Everything the store could still usefully fill in, worst first.
 *
 * ⛔ Never blocks. This is a prompt, not a gate: a store that genuinely cannot
 * produce a figure should be able to file everything else.
 */
export function completenessGaps(formData: Record<string, unknown>): Gap[] {
  return WATCHED.filter((gap) => isBlank(formData[gap.key]));
}

/**
 * Whether there is anything here to compare at all.
 *
 * Not expressible as a required field, because sales live on the category rows
 * rather than in a column. A submission with no sales anywhere is not a thin
 * submission, it is an empty one, and admitting it to the aggregate would move
 * every median it touches.
 */
export function hasAnySales(
  gmCategories: Pick<SurveyCategory, "lines">[],
  cmCategories: Pick<SurveyCategory, "lines">[],
): boolean {
  return [...gmCategories, ...cmCategories].some((category) =>
    category.lines.some(
      (line) => (line.retailSales ?? 0) > 0 || (line.onlineSales ?? 0) > 0,
    ),
  );
}
