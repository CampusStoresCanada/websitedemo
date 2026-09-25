"use client";

import { useState } from "react";
import type { FieldType } from "@/lib/benchmarking/default-field-config";
import { addSurveyQuestion } from "@/lib/actions/benchmarking-admin";

/**
 * Adding a question to a section.
 *
 * Kept separate from the rest of the editor because it is the only control here
 * that changes the DATABASE. Every other control edits `field_config` and takes
 * effect on Save; this one mints a column on the `benchmarking` table the moment
 * it is submitted, and cannot be undone by hitting Reset.
 *
 * So it saves on its own and then reloads, rather than joining the editor's
 * dirty-state. Half the editor's changes being pending while a column already
 * exists is the confusing state, and reloading is the cheapest way to avoid it.
 */

const TYPE_LABELS: { value: FieldType; label: string; hint: string }[] = [
  { value: "currency", label: "Currency", hint: "A dollar figure" },
  { value: "number", label: "Number", hint: "Any number, decimals allowed" },
  { value: "integer", label: "Whole number", hint: "Counts — staff, locations" },
  { value: "percentage", label: "Percentage", hint: "Stored as a percentage, so 32.99 means 32.99%" },
  { value: "text", label: "Short text", hint: "One line" },
  { value: "text_long", label: "Long text", hint: "A paragraph — how something works" },
  { value: "select", label: "Pick one", hint: "One choice from a list you set" },
  { value: "multiselect", label: "Pick several", hint: "Any number from a list you set" },
  { value: "boolean", label: "Yes / no", hint: "A single checkbox" },
];

/** Suggests a column name from the label, so nobody has to invent snake_case. */
function suggestName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 55);
}

export default function AddQuestion({
  surveyId,
  sectionId,
  sectionTitle,
  surveyStatus,
  hasUnsavedChanges,
}: {
  surveyId: string;
  sectionId: string;
  sectionTitle: string;
  surveyStatus: string;
  /** The editor has pending edits — they would be lost by the reload below. */
  hasUnsavedChanges: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [type, setType] = useState<FieldType>("currency");
  const [helpText, setHelpText] = useState("");
  const [optionsRaw, setOptionsRaw] = useState("");
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = nameTouched ? name : suggestName(label);
  const needsOptions = type === "select" || type === "multiselect";

  // Draft-only, and said up front rather than after they have typed a question.
  if (surveyStatus !== "draft") {
    return (
      <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        This survey is <strong>{surveyStatus}</strong>. Questions can only be added while it
        is in draft — adding one now would leave every store that has already filed with a
        blank nobody asked them. You can still edit the wording of existing questions.
      </p>
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await addSurveyQuestion({
      surveyId,
      sectionId,
      name: effectiveName,
      label: label.trim(),
      type,
      ...(helpText.trim() ? { helpText: helpText.trim() } : {}),
      ...(required ? { required: true } : {}),
      ...(needsOptions
        ? {
            options: optionsRaw
              .split("\n")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Could not add that question.");
      return;
    }
    // The column now exists. Reload so the editor is reading the saved config
    // rather than a stale copy that does not know about it.
    window.location.reload();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900"
      >
        + Add a question to {sectionTitle}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-300 bg-gray-50 p-4">
      <h4 className="text-sm font-semibold text-gray-900">
        New question in {sectionTitle}
      </h4>
      <p className="mt-1 text-xs text-gray-600">
        This creates a column on the benchmarking table. It saves immediately and cannot be
        undone with Reset.
      </p>

      {hasUnsavedChanges && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
          You have unsaved edits elsewhere in this survey. Save them first — adding a
          question reloads the page and those edits would be lost.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700">
            Question as the store sees it
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. How is your IA/EA programme delivered?"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700">
            Column name
          </label>
          <input
            type="text"
            value={effectiveName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Lowercase letters, digits and underscores. This is permanent — it is the column
            the answers live in, and every comparison and export names it.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700">Answer type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {TYPE_LABELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </select>
        </div>

        {needsOptions && (
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Choices, one per line
            </label>
            <textarea
              value={optionsRaw}
              onChange={(e) => setOptionsRaw(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700">
            Help text <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <textarea
            value={helpText}
            onChange={(e) => setHelpText(e.target.value)}
            rows={3}
            placeholder="What exactly to include, and what to leave out."
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={saving || !label.trim() || !effectiveName || hasUnsavedChanges}
          className="rounded-lg bg-[#163D6D] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add question"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-sm text-gray-600 underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
