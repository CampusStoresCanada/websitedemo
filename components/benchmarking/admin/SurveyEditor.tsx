"use client";

import { useState, useCallback } from "react";
import type {
  SurveyFieldConfig,
  SectionConfig,
  FieldConfig,
  FieldType,
} from "@/lib/benchmarking/default-field-config";
import { getCompatibleTypes } from "@/lib/benchmarking/default-field-config";
import {
  saveFieldConfig,
  resetFieldConfig,
} from "@/lib/actions/benchmarking-admin";

interface SurveyEditorProps {
  surveyId: string;
  surveyTitle: string;
  fiscalYear: number;
  initialConfig: SurveyFieldConfig;
}

export default function SurveyEditor({
  surveyId,
  surveyTitle,
  fiscalYear,
  initialConfig,
}: SurveyEditorProps) {
  const [config, setConfig] = useState<SurveyFieldConfig>(
    JSON.parse(JSON.stringify(initialConfig))
  );
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);

  const activeSection = config.sections.sort((a, b) => a.order - b.order)[activeSectionIdx];

  // ─── Helpers ───

  const updateConfig = useCallback((updater: (draft: SurveyFieldConfig) => void) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as SurveyFieldConfig;
      updater(next);
      return next;
    });
    setSaveMsg(null);
  }, []);

  const findSection = (cfg: SurveyFieldConfig, sectionId: string) =>
    cfg.sections.find((s) => s.id === sectionId);

  const findField = (section: SectionConfig, fieldName: string) =>
    section.fields.find((f) => f.name === fieldName);

  // ─── Section Actions ───

  const updateSectionTitle = (sectionId: string, title: string) => {
    updateConfig((cfg) => {
      const s = findSection(cfg, sectionId);
      if (s) s.title = title;
    });
  };

  const updateSectionDescription = (sectionId: string, desc: string) => {
    updateConfig((cfg) => {
      const s = findSection(cfg, sectionId);
      if (s) s.description = desc || undefined;
    });
  };

  const moveSectionUp = (idx: number) => {
    if (idx <= 0) return;
    updateConfig((cfg) => {
      const sorted = cfg.sections.sort((a, b) => a.order - b.order);
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx - 1].order;
      sorted[idx - 1].order = temp;
    });
    setActiveSectionIdx(idx - 1);
  };

  const moveSectionDown = (idx: number) => {
    if (idx >= config.sections.length - 1) return;
    updateConfig((cfg) => {
      const sorted = cfg.sections.sort((a, b) => a.order - b.order);
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx + 1].order;
      sorted[idx + 1].order = temp;
    });
    setActiveSectionIdx(idx + 1);
  };

  // ─── Field Actions ───

  const updateFieldProp = (
    sectionId: string,
    fieldName: string,
    prop: keyof FieldConfig,
    value: unknown
  ) => {
    updateConfig((cfg) => {
      const s = findSection(cfg, sectionId);
      if (!s) return;
      const f = findField(s, fieldName);
      if (!f) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f as any)[prop] = value;
    });
  };

  const moveFieldUp = (sectionId: string, fieldIdx: number) => {
    if (fieldIdx <= 0) return;
    updateConfig((cfg) => {
      const s = findSection(cfg, sectionId);
      if (!s) return;
      const sorted = s.fields.sort((a, b) => a.order - b.order);
      const temp = sorted[fieldIdx].order;
      sorted[fieldIdx].order = sorted[fieldIdx - 1].order;
      sorted[fieldIdx - 1].order = temp;
    });
  };

  const moveFieldDown = (sectionId: string, fieldIdx: number) => {
    updateConfig((cfg) => {
      const s = findSection(cfg, sectionId);
      if (!s) return;
      const sorted = s.fields.sort((a, b) => a.order - b.order);
      if (fieldIdx >= sorted.length - 1) return;
      const temp = sorted[fieldIdx].order;
      sorted[fieldIdx].order = sorted[fieldIdx + 1].order;
      sorted[fieldIdx + 1].order = temp;
    });
  };

  const moveFieldToSection = (
    fromSectionId: string,
    fieldName: string,
    toSectionId: string
  ) => {
    updateConfig((cfg) => {
      const fromSection = findSection(cfg, fromSectionId);
      const toSection = findSection(cfg, toSectionId);
      if (!fromSection || !toSection) return;
      const fieldIdx = fromSection.fields.findIndex((f) => f.name === fieldName);
      if (fieldIdx === -1) return;
      const [field] = fromSection.fields.splice(fieldIdx, 1);
      // Set order to end of target section
      const maxOrder = toSection.fields.reduce((max, f) => Math.max(max, f.order), 0);
      field.order = maxOrder + 1;
      toSection.fields.push(field);
    });
  };

  // ─── Save / Reset ───

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const result = await saveFieldConfig(surveyId, config);
    if (result.success) {
      setSaveMsg({ type: "success", text: "Saved successfully" });
    } else {
      setSaveMsg({ type: "error", text: result.error || "Save failed" });
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 5000);
  };

  const handleReset = async () => {
    if (!confirm("Reset all field config to defaults? This cannot be undone.")) return;
    setSaving(true);
    const result = await resetFieldConfig(surveyId);
    if (result.success) {
      // Reload page to get fresh default config
      window.location.reload();
    } else {
      setSaveMsg({ type: "error", text: result.error || "Reset failed" });
      setSaving(false);
    }
  };

  const sortedSections = [...config.sections].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Survey Editor</h1>
          <p className="text-sm text-gray-500 mt-1">
            {surveyTitle} &mdash; FY{fiscalYear}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span
              className={`text-sm ${
                saveMsg.type === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleReset}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Reset to Default
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium text-white bg-[#EE2A2E] rounded-lg hover:bg-[#D92327] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Section Panel (left) */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Sections
            </h3>
            <ul className="space-y-1">
              {sortedSections.map((section, idx) => (
                <li key={section.id}>
                  <button
                    onClick={() => setActiveSectionIdx(idx)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between ${
                      activeSectionIdx === idx
                        ? "bg-red-50 text-[#EE2A2E] font-medium"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="truncate">
                      {section.order}. {section.title}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">
                      {section.fields.filter((f) => f.visible !== false).length}
                    </span>
                  </button>
                  {activeSectionIdx === idx && (
                    <div className="flex gap-1 px-3 mt-1 mb-2">
                      <button
                        onClick={() => moveSectionUp(idx)}
                        disabled={idx === 0}
                        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move section up"
                      >
                        &#9650;
                      </button>
                      <button
                        onClick={() => moveSectionDown(idx)}
                        disabled={idx === sortedSections.length - 1}
                        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move section down"
                      >
                        &#9660;
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Field List (main) */}
        <div className="flex-1 min-w-0">
          {activeSection && (
            <div className="bg-white border border-gray-200 rounded-lg">
              {/* Section header editing */}
              <div className="p-4 border-b border-gray-200">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Section Title
                </label>
                <input
                  type="text"
                  value={activeSection.title}
                  onChange={(e) =>
                    updateSectionTitle(activeSection.id, e.target.value)
                  }
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
                />
                <label className="block text-xs font-medium text-gray-500 mb-1 mt-3">
                  Section Description (optional)
                </label>
                <input
                  type="text"
                  value={activeSection.description ?? ""}
                  onChange={(e) =>
                    updateSectionDescription(activeSection.id, e.target.value)
                  }
                  placeholder="Description shown below the section heading"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
                />
              </div>

              {/* Fields list */}
              <div className="divide-y divide-gray-100">
                {activeSection.fields
                  .sort((a, b) => a.order - b.order)
                  .map((field, fieldIdx) => (
                    <FieldRow
                      key={field.name}
                      field={field}
                      fieldIdx={fieldIdx}
                      sectionId={activeSection.id}
                      allSections={sortedSections}
                      isExpanded={expandedField === field.name}
                      onToggleExpand={() =>
                        setExpandedField(
                          expandedField === field.name ? null : field.name
                        )
                      }
                      onUpdateProp={(prop, value) =>
                        updateFieldProp(activeSection.id, field.name, prop, value)
                      }
                      onMoveUp={() => moveFieldUp(activeSection.id, fieldIdx)}
                      onMoveDown={() => moveFieldDown(activeSection.id, fieldIdx)}
                      onMoveToSection={(toSectionId) =>
                        moveFieldToSection(activeSection.id, field.name, toSectionId)
                      }
                      isFirst={fieldIdx === 0}
                      isLast={fieldIdx === activeSection.fields.length - 1}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Field Row — individual field editing UI
// ─────────────────────────────────────────────────────────────────

function FieldRow({
  field,
  sectionId,
  allSections,
  isExpanded,
  onToggleExpand,
  onUpdateProp,
  onMoveUp,
  onMoveDown,
  onMoveToSection,
  isFirst,
  isLast,
}: {
  field: FieldConfig;
  fieldIdx: number;
  sectionId: string;
  allSections: SectionConfig[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdateProp: (prop: keyof FieldConfig, value: unknown) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToSection: (toSectionId: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const compatibleTypes = getCompatibleTypes(field.type);
  const isCalculated = !!field.calculated;

  return (
    <div
      className={`px-4 py-3 ${
        !field.visible ? "opacity-50 bg-gray-50" : ""
      }`}
    >
      {/* Compact row */}
      <div className="flex items-center gap-3">
        {/* Reorder */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
          >
            &#9650;
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
          >
            &#9660;
          </button>
        </div>

        {/* Field name + label */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {field.label}
            </span>
            <span className="text-xs text-gray-400 font-mono">
              {field.name}
            </span>
            {isCalculated && (
              <span className="text-xs bg-blue-100 text-[#D92327] px-1.5 py-0.5 rounded">
                calc
              </span>
            )}
            {field.required && (
              <span className="text-xs text-red-500">required</span>
            )}
          </div>
        </div>

        {/* Type badge */}
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
          {field.type}
        </span>

        {/* Visible toggle */}
        <button
          onClick={() => onUpdateProp("visible", !field.visible)}
          className={`text-xs px-2 py-1 rounded border ${
            field.visible
              ? "border-green-300 text-green-700 bg-green-50"
              : "border-gray-300 text-gray-500 bg-gray-50"
          }`}
          title={field.visible ? "Visible — click to hide" : "Hidden — click to show"}
        >
          {field.visible ? "Visible" : "Hidden"}
        </button>

        {/* Expand */}
        <button
          onClick={onToggleExpand}
          className="text-gray-400 hover:text-gray-600"
          title="Edit field details"
        >
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-3 pl-8 grid grid-cols-2 gap-4 text-sm">
          {/* Label */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Label
            </label>
            <input
              type="text"
              value={field.label}
              onChange={(e) => onUpdateProp("label", e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Type
            </label>
            <select
              value={field.type}
              onChange={(e) => onUpdateProp("type", e.target.value as FieldType)}
              disabled={isCalculated}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent disabled:bg-gray-50"
            >
              {compatibleTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Tooltip */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tooltip (? icon)
            </label>
            <input
              type="text"
              value={field.tooltip ?? ""}
              onChange={(e) => onUpdateProp("tooltip", e.target.value || undefined)}
              placeholder="Help text shown in tooltip popup"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Help Text */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Help Text (inline)
            </label>
            <input
              type="text"
              value={field.helpText ?? ""}
              onChange={(e) => onUpdateProp("helpText", e.target.value || undefined)}
              placeholder="Inline description below the label"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Placeholder */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Placeholder
            </label>
            <input
              type="text"
              value={field.placeholder ?? ""}
              onChange={(e) => onUpdateProp("placeholder", e.target.value || undefined)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Suffix */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Suffix
            </label>
            <input
              type="text"
              value={field.suffix ?? ""}
              onChange={(e) => onUpdateProp("suffix", e.target.value || undefined)}
              placeholder="e.g., sq ft, years, %"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Required toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={field.required ?? false}
              onChange={(e) => onUpdateProp("required", e.target.checked || undefined)}
              className="rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
            />
            <label className="text-xs font-medium text-gray-500">
              Required
            </label>
          </div>

          {/* Group */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Group
            </label>
            <input
              type="text"
              value={field.group ?? ""}
              onChange={(e) => onUpdateProp("group", e.target.value || undefined)}
              placeholder="Visual group heading"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            />
          </div>

          {/* Select options */}
          {field.type === "select" && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Options (one per line)
              </label>
              <textarea
                value={(field.options ?? []).join("\n")}
                onChange={(e) =>
                  onUpdateProp(
                    "options",
                    e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
                rows={4}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
              />
            </div>
          )}

          {/* Move to section */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Move to Section
            </label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onMoveToSection(e.target.value);
              }}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#EE2A2E] focus:border-transparent"
            >
              <option value="">Stay in current section</option>
              {allSections
                .filter((s) => s.id !== sectionId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.order}. {s.title}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
