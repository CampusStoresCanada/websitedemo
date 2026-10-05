"use client";

import { useState } from "react";
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
  fieldKey,
  computed,
  override,
  onOverwrite,
}: {
  label: string;
  value: string;
  /**
   * Stable name for this calculated line, used as the note's field_name.
   *
   * ⛔ Not the label. A label is copy and will be reworded; a note written
   * against one would come loose from the figure it explains.
   */
  fieldKey?: string;
  /** What the survey worked out, so an override can record both. */
  computed?: number | null;
  /** What this store already said instead, if anything. */
  override?: { stated: number; note: string } | null;
  onOverwrite?: (fieldKey: string, computed: number | null) => void;
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
      className={`border-b border-gray-100 py-1.5 ${
        strong ? "font-semibold text-gray-900" : "text-gray-700"
      } ${indent ? "pl-4" : ""}`}
    >
    <div className="flex items-baseline justify-between gap-4">
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
      <span className="flex items-baseline gap-2">
        {override ? (
          <>
            <span className="text-xs text-gray-400 line-through tabular-nums">{value}</span>
            <span className="tabular-nums text-sm">{money(override.stated)}</span>
          </>
        ) : (
          jump
        )}
        {/*
          Wherever we calculate, the store can say it is something else.

          ⛔ Not a validation on the way past. Their system genuinely cannot
          produce some of these splits — online sales by category is the
          standing example — and a figure they are forced to leave at 0 enters
          the comparison as a fact. Overwriting it and saying why is the honest
          answer, and the why is what travels into the appendices.
        */}
        {fieldKey && onOverwrite && (
          <button
            type="button"
            onClick={() => onOverwrite(fieldKey, computed ?? null)}
            className="text-[11px] text-gray-400 underline underline-offset-2 hover:text-[#163D6D]"
          >
            {override ? "change" : "not right?"}
          </button>
        )}
      </span>
    </div>
      {override && (
        <p className="mt-1 text-[11px] text-gray-500">
          You changed this. {override.note}
        </p>
      )}
    </div>
  );
}

export default function ReviewFinancials({
  surveyId,
  organizationId,
  overrides = {},
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
  surveyId: string;
  organizationId: string;
  /** What this store has already overwritten, keyed by line. */
  overrides?: Record<string, { stated: number; note: string }>;
}) {
  const [editing, setEditing] = useState<{ fieldKey: string; computed: number | null } | null>(null);
  const [stated, setStated] = useState("");
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, { stated: number; note: string }>>({});

  const current = { ...overrides, ...saved };

  const openOverwrite = (fieldKey: string, computed: number | null) => {
    setSaveError(null);
    setStated(current[fieldKey] ? String(current[fieldKey].stated) : computed !== null ? String(computed) : "");
    setWhy(current[fieldKey]?.note ?? "");
    setEditing({ fieldKey, computed });
  };

  async function saveOverwrite() {
    if (!editing) return;
    const value = Number(stated);
    if (!Number.isFinite(value)) { setSaveError("Give a number."); return; }
    /*
      ⛔ The reason is required, not optional. The figure travels into a report
      the whole membership reads; a changed number with no explanation is worse
      than the calculated one, because nobody can tell it was changed on purpose.
    */
    if (why.trim().length < 3) { setSaveError("Say why, so it can travel with the figure."); return; }

    setSaving(true);
    const { writeNote } = await import("@/lib/actions/benchmarking-notes");
    const res = await writeNote({
      surveyId,
      organizationId,
      fieldName: editing.fieldKey,
      note: why.trim(),
      statedValue: value,
      computedValue: editing.computed,
      submit: true,
    });
    setSaving(false);
    if (!res.success) { setSaveError(res.error ?? "Could not save that."); return; }
    setSaved((p) => ({ ...p, [editing.fieldKey]: { stated: value, note: why.trim() } }));
    setEditing(null);
  }

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
      {editing && (
        <div className="mb-4 rounded-lg border-l-4 border-[#163D6D] bg-blue-50 p-4">
          <p className="text-sm font-semibold text-gray-900">
            Change this figure to what it really is
          </p>
          <p className="mt-1 text-xs text-gray-700">
            We worked this out from your answers. If your system cannot produce
            it that way, put the right number in and tell us why. Your
            explanation is published beside the figure, so nobody reads it
            without the context.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-gray-700">
              <span className="mr-2">We calculated</span>
              <span className="tabular-nums font-medium">{money(editing.computed)}</span>
            </label>
            <label className="text-xs text-gray-700">
              <span className="mr-2">It is actually</span>
              <input
                value={stated}
                onChange={(e) => setStated(e.target.value)}
                inputMode="decimal"
                className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={2}
            placeholder="Why is the calculated figure wrong for your store?"
            className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          {saveError && <p className="mt-2 text-xs text-red-700">{saveError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={saveOverwrite}
              disabled={saving}
              className="rounded bg-[#163D6D] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Yes, use my number"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-xs text-gray-600 underline underline-offset-2"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Line
          label="General merchandise — retail"
          fieldKey="gm_retail"
          computed={gmRetail}
          override={current["gm_retail"] ?? null}
          onOverwrite={openOverwrite}
          value={money(gmRetail)}
          from="Every category's Retail column in General Merchandise, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="General merchandise — online"
          fieldKey="gm_online"
          computed={gmOnline}
          override={current["gm_online"] ?? null}
          onOverwrite={openOverwrite}
          value={money(gmOnline)}
          from="Every category's Online column in General Merchandise, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Course materials — retail"
          fieldKey="cm_retail"
          computed={cmRetail}
          override={current["cm_retail"] ?? null}
          onOverwrite={openOverwrite}
          value={money(cmRetail)}
          from="Every category's Retail column in Course Materials, added up"
          indent
          onJump={() => onJumpToSection("course_materials")}
        />
        <Line
          label="Course materials — online"
          fieldKey="cm_online"
          computed={cmOnline}
          override={current["cm_online"] ?? null}
          onOverwrite={openOverwrite}
          value={money(cmOnline)}
          from="Every category's Online column in Course Materials, added up"
          indent
          onJump={() => onJumpToSection("course_materials")}
        />
        <Line
          label="Other income"
          fieldKey="other_income"
          computed={other}
          override={current["other_income"] ?? null}
          onOverwrite={openOverwrite}
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
          fieldKey="total_revenue"
          computed={netSales}
          override={current["total_revenue"] ?? null}
          onOverwrite={openOverwrite}
          value={money(netSales)}
          strong
          from="Merchandise, course materials, other income and institutional funding"
        />

        <div className="h-3" />

        <Line
          label="Gross margin"
          fieldKey="gross_margin"
          computed={grossMargin}
          override={current["gross_margin"] ?? null}
          onOverwrite={openOverwrite}
          value={money(grossMargin)}
          strong
          from="Each category's sales multiplied by the gross margin % you gave it, added up"
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Opening inventory, at cost"
          fieldKey="inventory_open"
          computed={invOpen}
          override={current["inventory_open"] ?? null}
          onOverwrite={openOverwrite}
          value={money(invOpen)}
          from="Every category's Opening inventory, added up"
          indent
          onJump={() => onJumpToSection("general_merchandise")}
        />
        <Line
          label="Closing inventory, at cost"
          fieldKey="inventory_close"
          computed={invClose}
          override={current["inventory_close"] ?? null}
          onOverwrite={openOverwrite}
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
          fieldKey="operating_expenses"
          computed={expenseTotal}
          override={current["operating_expenses"] ?? null}
          onOverwrite={openOverwrite}
          value={money(expenseTotal)}
          strong
          from="Every expense line above, added up"
        />

        <div className="h-3" />

        <Line
          label="Operating income"
          fieldKey="operating_income"
          computed={operatingIncome}
          override={current["operating_income"] ?? null}
          onOverwrite={openOverwrite}
          value={money(operatingIncome)}
          strong
          from="Gross margin less total operating expenses"
        />

        <div className="h-4" />

        <Line
          label="Total campus contribution"
          fieldKey="campus_contribution"
          computed={contributionTotal}
          override={current["campus_contribution"] ?? null}
          onOverwrite={openOverwrite}
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
              : "You asked us to leave this out of your revenue, so it is not in the statement above. We will still report the program's scale separately."}
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
