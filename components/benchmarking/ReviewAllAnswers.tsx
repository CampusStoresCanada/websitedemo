"use client";

import { useMemo } from "react";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { matchesShowIf } from "@/lib/benchmarking/show-if";

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

export default function ReviewAllAnswers({
  config,
  formData,
  onJumpToField,
  onClose,
}: {
  config: SurveyFieldConfig;
  formData: Record<string, unknown>;
  /** Go to the section holding this field, and light the field up. */
  onJumpToField: (sectionId: string, fieldName: string) => void;
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
        .filter((s) => s.fields.length > 0),
    [config, formData],
  );

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
            Read it through before you submit. Click any answer to go and change it —
            you will land on that question, and a button will bring you straight back
            here.
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

      <div className="mt-5 space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <h4 className="text-sm font-semibold text-gray-900">
              {section.order}. {section.title}
            </h4>
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

      <p className="mt-6 text-xs text-gray-500">
        The categories, locations, people and income lines you added are shown in their
        own sections rather than listed here — they are lists rather than single
        answers, and they read better where you built them.
      </p>
    </div>
  );
}
