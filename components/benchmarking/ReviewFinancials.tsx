"use client";

import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";
import type { OtherIncomeRow, OtherExpenseRow } from "@/lib/actions/benchmarking-financials";
import {
  NAMED_EXPENSE_LINES,
  CONTRIBUTION_LINES,
  sumCategories,
  grossMarginFromCategories,
  sumFields,
} from "@/lib/benchmarking/financial-lines";

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
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b border-gray-100 py-1.5 ${
        strong ? "font-semibold text-gray-900" : "text-gray-700"
      } ${indent ? "pl-4" : ""}`}
    >
      <button
        type="button"
        title={from}
        onClick={onJump}
        disabled={!onJump}
        className="text-left text-sm underline decoration-dotted underline-offset-4 hover:decoration-solid disabled:no-underline"
      >
        {label}
      </button>
      <span className="tabular-nums text-sm">{value}</span>
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

  const gmRetail = sumCategories(gmCategories, "retailSales");
  const gmOnline = sumCategories(gmCategories, "onlineSales");
  const cmRetail = sumCategories(cmCategories, "retailSales");
  const cmOnline = sumCategories(cmCategories, "onlineSales");
  const other = otherIncome.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const funding = num("central_funding") ?? 0;

  const netSales = gmRetail + gmOnline + cmRetail + cmOnline + other + funding;

  const invOpen =
    sumCategories(gmCategories, "inventoryOpen") + sumCategories(cmCategories, "inventoryOpen");
  const invClose =
    sumCategories(gmCategories, "inventoryClose") + sumCategories(cmCategories, "inventoryClose");

  const marginDollars =
    grossMarginFromCategories(gmCategories) + grossMarginFromCategories(cmCategories);
  const grossMargin = marginDollars > 0 ? marginDollars : null;

  const expenseTotal =
    sumFields(formData, NAMED_EXPENSE_LINES) +
    otherExpenses.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const operatingIncome = grossMargin !== null ? grossMargin - expenseTotal : null;

  const contributionTotal = sumFields(formData, CONTRIBUTION_LINES);
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
          from="Every line you entered in Other Income, added up"
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

        {NAMED_EXPENSE_LINES.map((line) => (
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
          No gross margin yet. Add a target margin to at least one category and this fills in.
        </p>
      )}
    </div>
  );
}
