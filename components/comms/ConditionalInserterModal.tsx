"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Search, Plus } from "lucide-react";
import {
  CONDITION_SUBJECTS,
  OPERATORS_BY_FIELD_TYPE,
  type ConditionSubjectKey,
  type ConditionOperator,
} from "@/lib/comms/conditions/registry";

export interface SavedCondition {
  key: string;
  label: string;
}

/** One option in the "which instance" picker for a referenced subject (which event, which checklist task, ...) — same shape regardless of subject, fetched from that subject's requiresReference.endpoint. */
interface ReferenceOption {
  id: string;
  title: string;
}

interface ConditionalInserterModalProps {
  onInsert: (condition: SavedCondition) => void;
  onClose: () => void;
}

const VALUE_OPERATORS = new Set<ConditionOperator>(["equals", "not_equals", "contains", "before", "after"]);

export default function ConditionalInserterModal({ onInsert, onClose }: ConditionalInserterModalProps) {
  const [mode, setMode] = useState<"browse" | "build">("browse");
  const [saved, setSaved] = useState<SavedCondition[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [search, setSearch] = useState("");

  // Build-new state
  const [subject, setSubject] = useState<ConditionSubjectKey | "">("");
  const [field, setField] = useState("");
  const [operator, setOperator] = useState<ConditionOperator | "">("");
  const [value, setValue] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [referenceOptions, setReferenceOptions] = useState<ReferenceOption[]>([]);
  const [loadingReferenceOptions, setLoadingReferenceOptions] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetch("/api/admin/comms/conditions")
      .then((r) => r.json())
      .then((data) => setSaved(data.conditions ?? []))
      .finally(() => setLoadingSaved(false));
  }, []);

  const subjectDef = subject ? CONDITION_SUBJECTS[subject] : null;
  const fieldDef = subjectDef && field ? subjectDef.fields[field] : null;
  const operators = fieldDef ? OPERATORS_BY_FIELD_TYPE[fieldDef.type] : [];
  const needsValue = operator && VALUE_OPERATORS.has(operator);
  const needsReference = !!subjectDef?.requiresReference;

  const referenceEndpoint = subjectDef?.requiresReference?.endpoint;
  useEffect(() => {
    if (!referenceEndpoint) return;
    // Keyed on the endpoint (not just "has this subject changed"), and
    // always refetches + clears stale options first — switching between
    // two different referenced subjects (e.g. Event Registration →
    // Checklist Task) must not leave the previous subject's options
    // showing while the new ones load.
    setLoadingReferenceOptions(true);
    setReferenceOptions([]);
    fetch(referenceEndpoint)
      .then((r) => r.json())
      .then((data) => setReferenceOptions(data.options ?? []))
      .finally(() => setLoadingReferenceOptions(false));
  }, [referenceEndpoint]);

  const autoLabel = useMemo(() => {
    if (!subjectDef || !fieldDef || !operator) return "";
    const opLabel = operators.find((o) => o.value === operator)?.label ?? operator;
    const referenceLabel = needsReference ? referenceOptions.find((o) => o.id === referenceId)?.title : null;
    const valuePart = needsValue && value ? ` "${value}"` : "";
    return `${subjectDef.label}${referenceLabel ? ` (${referenceLabel})` : ""}: ${fieldDef.label} ${opLabel}${valuePart}`;
  }, [subjectDef, fieldDef, operator, operators, needsReference, needsValue, value, referenceOptions, referenceId]);

  const filteredSaved = saved.filter((c) => c.label.toLowerCase().includes(search.toLowerCase()));

  const canSave = subject && field && operator && (!needsReference || referenceId) && (label || autoLabel);

  async function handleSave() {
    if (!subject || !field || !operator) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/admin/comms/conditions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || autoLabel,
          subject,
          field,
          operator,
          value: needsValue ? value : undefined,
          referenceId: needsReference ? referenceId : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setSaveError(data.error ?? "Failed to save condition");
        return;
      }
      onInsert({ key: data.key, label: label || autoLabel });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex flex-col bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Insert Conditional</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X size={15} />
          </button>
        </div>

        {mode === "browse" ? (
          <div className="flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search saved conditions…"
                  className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingSaved ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">Loading…</p>
              ) : filteredSaved.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">No saved conditions yet.</p>
              ) : (
                filteredSaved.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => onInsert(c)}
                    className="block w-full text-left rounded-lg px-3 py-2 text-sm text-gray-800 hover:bg-blue-50 hover:text-accent transition-colors"
                  >
                    {c.label}
                  </button>
                ))
              )}
            </div>

            <div className="p-3 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => setMode("build")}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Plus size={13} /> New Condition
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
              <select
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value as ConditionSubjectKey);
                  setField("");
                  setOperator("");
                  setReferenceId("");
                }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
              >
                <option value="">Pick a subject…</option>
                {Object.entries(CONDITION_SUBJECTS).map(([key, def]) => (
                  <option key={key} value={key}>
                    {def.label}
                  </option>
                ))}
              </select>
            </div>

            {needsReference && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {subjectDef?.requiresReference?.label}
                </label>
                <select
                  value={referenceId}
                  onChange={(e) => setReferenceId(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                >
                  <option value="">{loadingReferenceOptions ? "Loading…" : "Pick one…"}</option>
                  {referenceOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {subjectDef && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Field</label>
                <select
                  value={field}
                  onChange={(e) => {
                    setField(e.target.value);
                    setOperator("");
                  }}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                >
                  <option value="">Pick a field…</option>
                  {Object.entries(subjectDef.fields).map(([key, def]) => (
                    <option key={key} value={key}>
                      {def.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {fieldDef && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Condition</label>
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as ConditionOperator)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                >
                  <option value="">Pick a condition…</option>
                  {operators.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {needsValue && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Value</label>
                {fieldDef?.type === "enum" ? (
                  <select
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                  >
                    <option value="">Pick a value…</option>
                    {fieldDef.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    type={fieldDef?.type === "date" ? "date" : "text"}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                  />
                )}
              </div>
            )}

            {operator && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Name <span className="text-gray-400 font-normal">(for reuse later)</span>
                </label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={autoLabel}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
                />
              </div>
            )}

            {saveError && <p className="text-xs text-red-600">{saveError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || saving}
                className="flex-1 rounded-lg bg-[#EE2A2E] px-3 py-2 text-sm font-medium text-white hover:bg-[#D92327] disabled:opacity-40 transition-colors"
              >
                {saving ? "Saving…" : "Save & Insert"}
              </button>
              <button
                type="button"
                onClick={() => setMode("browse")}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
