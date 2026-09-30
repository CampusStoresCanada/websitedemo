"use client";

import { useMemo } from "react";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { matchesShowIf } from "@/lib/benchmarking/show-if";
import { completenessGaps } from "@/lib/benchmarking/completeness";
import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";
import type {
  OtherIncomeRow,
  OtherExpenseRow,
  StaffRow,
} from "@/lib/actions/benchmarking-financials";
import type { CompetitorRow } from "@/lib/actions/benchmarking-competitors";
import type { SurveyLocation } from "@/lib/actions/benchmarking-locations";
import type { KeyDate } from "@/lib/actions/benchmarking-profile";

/**
 * Every answer on one screen, before anything is submitted.
 *
 * A ten-section form is filled over days, and nobody can hold what they said in
 * section 2 while answering section 7. This is the only place the whole thing
 * is visible at once, which makes it the only place a store can catch the
 * figure that went in the wrong box. Each answer clicks through to where it
 * lives, and the way back is always one button away — go and fix one thing,
 * come straight back, without re-walking the sections in between.
 *
 * ⛔ Reads the same config the form renders and the same showIf evaluator, so a
 * question hidden by a conditional is absent here too. A review that listed
 * questions the store was never shown would read as an accusation.
 */

function displayValue(value: unknown): { text: string; answered: boolean } {
  if (value === null || value === undefined || value === "") {
    return { text: "Not answered", answered: false };
  }
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", answered: true };
  if (Array.isArray(value)) {
    return value.length > 0
      ? { text: value.join(", "), answered: true }
      : { text: "Not answered", answered: false };
  }
  return { text: String(value), answered: true };
}


/** Sections that carry a list even when they have no scalar fields left. */
const SECTIONS_WITH_LISTS = [
  "institution_profile",
  "general_merchandise",
  "course_materials",
  "other_income",
  "staffing",
  "expenses",
];

const money = (n: number | null | undefined) =>
  typeof n === "number"
    ? n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })
    : "—";

function ListBlock({
  title,
  empty,
  rows,
  onJump,
}: {
  title: string;
  empty: string;
  rows: { key: string; left: string; right?: string }[];
  onJump: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <button
          onClick={onJump}
          className="text-xs text-[#163D6D] underline underline-offset-4"
        >
          Change
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm italic text-gray-400">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-4 text-sm text-gray-700">
              <span>{r.left}</span>
              {r.right && <span className="tabular-nums">{r.right}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReviewAllAnswers({
  config,
  formData,
  lists,
  onJumpToField,
  onJumpToSection,
  onClose,
}: {
  config: SurveyFieldConfig;
  formData: Record<string, unknown>;
  /**
   * The parts of the submission that are lists rather than single answers.
   *
   * They were left out of the first version with a footnote saying they read
   * better where they were built. That made this screen a review of the FIELDS,
   * not of the submission, so the one place meant to show everything at once
   * was missing the categories the whole report is built from.
   */
  lists: {
    gmCategories: SurveyCategory[];
    cmCategories: SurveyCategory[];
    otherIncome: OtherIncomeRow[];
    otherExpenses: OtherExpenseRow[];
    staff: StaffRow[];
    competitors: CompetitorRow[];
    locations: SurveyLocation[];
    keyDates: KeyDate[];
  };
  /** Go to the section holding this field, and light the field up. */
  onJumpToField: (sectionId: string, fieldName: string) => void;
  onJumpToSection: (sectionId: string) => void;
  onClose: () => void;
}) {
  const sections = useMemo(
    () =>
      [...config.sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => ({
          id: section.id,
          order: section.order,
          title: section.title,
          fields: section.fields
            .filter((f) => f.visible !== false)
            .filter((f) => !f.calculated && !f.displayOnly)
            .filter((f) => matchesShowIf(f.showIf, formData))
            .sort((a, b) => a.order - b.order),
        }))
        /*
          A section stays if it has answers OR lists.

          ⛔ Filtering on fields alone dropped §2 General Merchandise out of the
          review entirely: every one of its scalar fields was retired when the
          category grid replaced them, so the section the whole report is built
          from had nothing left to count and vanished from the one screen meant
          to show everything.
        */
        .filter((s) => s.fields.length > 0 || SECTIONS_WITH_LISTS.includes(s.id)),
    [config, formData],
  );

  /** The list blocks belonging to a section, if it has any. */
  function listsFor(sectionId: string) {
    const jump = () => onJumpToSection(sectionId);
    const cats = (list: SurveyCategory[], title: string) => (
      <ListBlock
        title={title}
        empty="None added."
        onJump={jump}
        rows={list.map((c) => ({
          key: c.id,
          left: c.department,
          right: money(
            c.lines.reduce((t, l) => t + (l.retailSales ?? 0) + (l.onlineSales ?? 0), 0),
          ),
        }))}
      />
    );

    switch (sectionId) {
      case "institution_profile":
        return (
          <>
            <ListBlock
              title="Locations"
              empty="None added."
              onJump={jump}
              rows={lists.locations.map((l) => ({
                key: l.id,
                left: l.name || "Unnamed location",
                right: l.kind ?? undefined,
              }))}
            />
            <ListBlock
              title="Your year ahead"
              empty="No dates added."
              onJump={jump}
              rows={lists.keyDates.map((d) => ({
                key: d.id,
                left: d.label,
                right: d.occursOn ?? "No date",
              }))}
            />
            <ListBlock
              title="Who competes with you"
              empty="None added."
              onJump={jump}
              rows={lists.competitors.map((c) => ({
                key: c.id,
                left: c.name,
                right: c.kind ?? undefined,
              }))}
            />
          </>
        );
      case "general_merchandise":
        return cats(lists.gmCategories, "Categories you carry");
      case "course_materials":
        return cats(lists.cmCategories, "Formats you sell");
      case "other_income":
        return (
          <ListBlock
            title="Income lines"
            empty="None added."
            onJump={jump}
            rows={lists.otherIncome.map((r) => ({
              key: r.id,
              left: r.countsAsIncome ? r.label : `${r.label} (not counted as income)`,
              right: money(r.amount),
            }))}
          />
        );
      case "staffing":
        return (
          <ListBlock
            title="Your team"
            empty="Nobody added."
            onJump={jump}
            rows={lists.staff.map((p) => ({
              key: p.id,
              left: p.name,
              right:
                typeof p.yearsInCampusRetail === "number"
                  ? `${p.yearsInCampusRetail} yrs`
                  : undefined,
            }))}
          />
        );
      case "expenses":
        return (
          <ListBlock
            title="Expenses you named yourself"
            empty="None added."
            onJump={jump}
            rows={lists.otherExpenses.map((r) => ({
              key: r.id,
              left: r.label,
              right: money(r.amount),
            }))}
          />
        );
      default:
        return null;
    }
  }

  const gaps = completenessGaps(formData);

  const missing = sections.flatMap((s) =>
    s.fields
      .filter((f) => f.required && !displayValue(formData[f.name]).answered)
      .map((f) => ({ section: s, field: f })),
  );

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Everything you have answered
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Read it through before you submit. Click any answer to go and change it. You
            will land on that question, and a button will bring you straight back here.
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to the form
        </button>
      </div>

      {missing.length > 0 && (
        <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            {missing.length === 1
              ? "One required answer is still missing"
              : `${missing.length} required answers are still missing`}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {missing.map(({ section, field }) => (
              <li key={field.name}>
                <button
                  onClick={() => onJumpToField(section.id, field.name)}
                  className="text-sm text-amber-900 underline underline-offset-4"
                >
                  {section.order}. {section.title} — {field.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        What each blank costs, rather than a rule saying it must be filled.

        Only eight figures are watched, each one chosen because leaving it out
        silently removes the store from something it would otherwise get back. A
        list of every empty box is a list nobody reads, and a red asterisk on
        all of them would block the stores whose institutions genuinely do not
        give them the number.
      */}
      {gaps.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-900">
            You can file without these, but here is what each one costs you
          </p>
          <ul className="mt-2 space-y-2">
            {gaps.map((gap) => (
              <li key={gap.key}>
                <button
                  onClick={() => onJumpToField(gap.section, gap.key)}
                  className="text-left text-sm font-medium text-[#163D6D] underline underline-offset-4"
                >
                  {gap.label}
                </button>
                <p className="text-xs text-gray-600">{gap.cost}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <h4 className="text-sm font-semibold text-gray-900">
              {section.order}. {section.title}
            </h4>
            {listsFor(section.id)}
            <dl className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
              {section.fields.map((field) => {
                const { text, answered } = displayValue(formData[field.name]);
                return (
                  <div
                    key={field.name}
                    className="flex items-baseline justify-between gap-6 py-1.5"
                  >
                    <dt className="flex-1 text-sm text-gray-700">
                      {field.label}
                      {field.required && !answered && (
                        <span className="ml-1 text-red-600">*</span>
                      )}
                    </dt>
                    <dd className="text-right">
                      <button
                        onClick={() => onJumpToField(section.id, field.name)}
                        className={`text-sm underline decoration-dotted underline-offset-4 hover:decoration-solid ${
                          answered ? "text-gray-900" : "text-gray-400 italic"
                        }`}
                      >
                        {text}
                      </button>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

    </div>
  );
}
