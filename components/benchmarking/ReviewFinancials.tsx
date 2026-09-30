"use client";

import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";
import type { OtherIncomeRow, OtherExpenseRow } from "@/lib/actions/benchmarking-financials";
import {
  NAMED_EXPENSE_LINES,
  CONTRIBUTION_LINES,
  sumCategories,
  grossMarginFromCategories,
  sumFields,
  countedLines,
  deriveStatement,
  strandedBySplit,
} from "@/lib/benchmarking/financial-lines";
import Explain from "./Explain";

/**
 * §8 — the income statement, assembled from what the store actually answered.
 *
 * This is the section that decides whether a director believes the report. A
 * total on its own asks to be trusted; showing the derivation back to the exact
 * answers lets someone check it against the P&L they manage, and makes a wrong
 * figure findable instead of merely suspicious.
 *
 * ⛔ Nothing here is stored. Every line is computed from the sections, so it
 * cannot disagree with them — a cached total that drifts from its inputs is
 * worse than no total, because it still looks authoritative.
 */

const money = (n: number | null) =>
  n === null
    ? "—"
    : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

function Line({
  label,
  value,
  from,
  strong,
  indent,
  onJump,
}: {
  label: string;
  value: string;
  /** Exactly where this came from, so a wrong number is findable. */
  from: string;
  strong?: boolean;
  indent?: boolean;
  onJump?: () => void;
}) {
  /*
    The figure is clickable as well as the label.

    A reader scanning a statement stops at the number that looks wrong, not at
    the words beside it — so the number is where they try to click, and a label
    that was the only target sent them back to hunt for it.
  */
  const jump = onJump ? (
    <button
      type="button"
      onClick={onJump}
      className="tabular-nums text-sm underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {value}
    </button>
  ) : (
    <span className="tabular-nums text-sm">{value}</span>
  );

  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b border-gray-100 py-1.5 ${
        strong ? "font-semibold text-gray-900" : "text-gray-700"
      } ${indent ? "pl-4" : ""}`}
    >
      <Explain text={from}>
        {onJump ? (
          <button
            type="button"
            onClick={onJump}
            className="text-left text-sm hover:text-[#163D6D]"
          >
            {label}
          </button>
        ) : (
          <span className="text-sm">{label}</span>
        )}
      </Explain>
      {jump}
    </div>
  );
}

export default function ReviewFinancials({
  gmCategories,
  cmCategories,
  otherIncome,
  otherExpenses,
  formData,
  onJumpToSection,
}: {
  gmCategories: SurveyCategory[];
  cmCategories: SurveyCategory[];
  otherIncome: OtherIncomeRow[];
  otherExpenses: OtherExpenseRow[];
  formData: Record<string, unknown>;
  onJumpToSection: (sectionId: string) => void;
}) {
  const num = (key: string) => {
    const value = formData[key];
    return typeof value === "number" ? value : null;
  };

  /*
    ⛔ The same derivation the REPORT uses, not a second one beside it.

    These figures were computed inline here while lib/benchmarking/metrics.ts
    computed its own from the flat columns the category grid replaced. A store
    would have read a complete statement on this screen and been compared on a
    page of nulls. One function now, so the screen and the report cannot say
    different things about the same store.
  */
  const statement = deriveStatement({
    gmCategories,
    cmCategories,
    otherIncome,
    otherExpenses,
    formData,
  });

  const gmRetail = sumCategories(gmCategories, "retailSales");
  const gmOnline = sumCategories(gmCategories, "onlineSales");
  const cmRetail = sumCategories(cmCategories, "retailSales");
  const cmOnline = sumCategories(cmCategories, "onlineSales");

  const other = statement.otherIncome;
  const excludedIncome = otherIncome.filter(
    (row) => !row.countsAsIncome && (row.amount ?? 0) > 0,
  );

  const netSales = statement.totalRevenue ?? 0;
  const invOpen = statement.openingInventory ?? 0;
  const invClose = statement.closingInventory ?? 0;
  const grossMargin = statement.grossMargin;

  const uncountedDirectCosts = otherIncome.filter(
    (row) => !row.directCostInExpenses && (row.directCost ?? 0) > 0,
  );

  /*
    Figures a split has stranded. Loud, because this is the one way a store can
    watch its largest category become zero with the number still sitting there
    looking perfectly fine.
  */
  const stranded = [
    ...strandedBySplit(gmCategories).map((s) => ({ ...s, section: "general_merchandise" })),
    ...strandedBySplit(cmCategories).map((s) => ({ ...s, section: "course_materials" })),
  ];

  const expenseTotal = statement.operatingExpenses;
  const operatingIncome = statement.operatingIncome;
  const contributionTotal = statement.campusContribution;
  const contributionPct = netSales > 0 ? (contributionTotal / netSales) * 100 : null;

  /*
    IA/EA money the institution collected is shown beside the statement, never
    inside it — whether it belongs in the comparison is the store's call, made
    in §10, and this section must not quietly decide it either way.
  */
  const institutionCollected = num("ia_ea_institution_amount");
  const countsAsRevenue = formData.ia_ea_count_as_revenue === true;

  return (
    <div className="mb-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Line
          label="General merchandise — retail"
          value={money(gmRetail)}
          from="Every category's Retail column in General Merchandise, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="General merchandise — online"
          value={money(gmOnline)}
          from="Every category's Online column in General Merchandise, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Course materials — retail"
          value={money(cmRetail)}
          from="Every category's Retail column in Course Materials, added up"
          indent
          onJump={() => onJumpToSection("course_materials")}
        />
        <Line
          label="Course materials — online"
          value={money(cmOnline)}
          from="Every category's Online column in Course Materials, added up"
          indent
          onJump={() => onJumpToSection("course_materials")}
        />
        <Line
          label="Other income"
          value={money(other)}
          from="Every line in Other Income you ticked as income, added up. Lines you unticked are shown below the statement instead."
          indent
          onJump={() => onJumpToSection("other_income")}
        />
        <Line
          label="Funding from the institution"
          value={money(num("central_funding"))}
          from="Answered in Other Income"
          indent
          onJump={() => onJumpToSection("other_income")}
        />
        <Line
          label="Total revenue"
          value={money(netSales)}
          strong
          from="Merchandise, course materials, other income and institutional funding"
        />

        <div className="h-3" />

        <Line
          label="Gross margin"
          value={money(grossMargin)}
          strong
          from="Each category's sales multiplied by the gross margin % you gave it, added up"
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Opening inventory, at cost"
          value={money(invOpen)}
          from="Every category's Opening inventory, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Closing inventory, at cost"
          value={money(invClose)}
          from="Every category's Closing inventory, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />

        <div className="h-3" />

        {countedLines(formData, NAMED_EXPENSE_LINES).map((line) => (
          <Line
            key={line.name}
            label={line.label}
            value={money(num(line.name))}
            indent
            from={`Answered in ${line.section === "staffing" ? "Staffing" : "Expenses"}`}
            onJump={() => onJumpToSection(line.section)}
          />
        ))}
        {otherExpenses.map((row) => (
          <Line
            key={row.id}
            label={row.label}
            value={money(row.amount)}
            indent
            from="An expense you named yourself, in Expenses"
            onJump={() => onJumpToSection("expenses")}
          />
        ))}
        {uncountedDirectCosts.map((row) => (
          <Line
            key={`direct-${row.id}`}
            label={`Cost of delivering ${row.label.toLowerCase()}`}
            value={money(row.directCost)}
            indent
            from="You told us this cost is not in your Expenses section, so it is added here. Untick that in Other Income if it is already counted."
            onJump={() => onJumpToSection("other_income")}
          />
        ))}
        <Line
          label="Total operating expenses"
          value={money(expenseTotal)}
          strong
          from="Every expense line above, added up"
        />

        <div className="h-3" />

        <Line
          label="Operating income"
          value={money(operatingIncome)}
          strong
          from="Gross margin less total operating expenses"
        />

        <div className="h-4" />

        <Line
          label="Total campus contribution"
          value={money(contributionTotal)}
          strong
          from="Everything in Campus Contributions, plus student wages and the university administrative charge"
          onJump={() => onJumpToSection("campus_contributions")}
        />
        <Line
          label="Contribution as a share of revenue"
          value={pct(contributionPct)}
          from="Total campus contribution divided by total revenue"
          indent
        />
      </div>

      {stranded.length > 0 && (
        <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Some figures are not being counted
          </p>
          <p className="mt-1 text-xs text-amber-900">
            You broke these categories into subcategories after entering a figure for the
            whole department. The department figure is still there but nothing counts it,
            because the subcategory rows are what you are reporting now. Put the figures on
            the subcategory rows, or untick the split to go back to one line.
          </p>
          <ul className="mt-2 space-y-1">
            {stranded.map((item) => (
              <li key={item.department} className="flex justify-between text-sm">
                <button
                  type="button"
                  onClick={() => onJumpToSection(item.section)}
                  className="text-left text-amber-900 underline underline-offset-4"
                >
                  {item.department}
                </button>
                <span className="tabular-nums text-amber-900">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {excludedIncome.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-900">Earned, but not counted as revenue</p>
          <p className="mt-1 text-xs text-gray-600">
            You told us these run at cost rather than as income, so they are outside the
            statement above. We still report what they earned.
          </p>
          <ul className="mt-2 space-y-1">
            {excludedIncome.map((row) => (
              <li key={row.id} className="flex justify-between">
                <button
                  type="button"
                  onClick={() => onJumpToSection("other_income")}
                  className="text-left underline decoration-dotted underline-offset-4"
                >
                  {row.label}
                </button>
                <span className="tabular-nums">{money(row.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {institutionCollected !== null && institutionCollected > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <button
              type="button"
              onClick={() => onJumpToSection("inclusive_access")}
              className="text-left underline decoration-dotted underline-offset-4"
            >
              Inclusive or Equitable Access collected by the institution
            </button>
            <span className="tabular-nums font-medium">{money(institutionCollected)}</span>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            {countsAsRevenue
              ? "You asked us to count this as part of your revenue. It sits outside the statement above because it never passed through your books, and we will say so wherever we use it."
              : "You asked us to leave this out of your revenue, so it is not in the statement above. We will still report the programme's scale separately."}
          </p>
        </div>
      )}

      {grossMargin === null && (
        <p className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
          No gross margin yet. Add a gross margin % to at least one category and this fills
          in.
        </p>
      )}
    </div>
  );
}
