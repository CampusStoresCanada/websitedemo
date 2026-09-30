"use client";

import { useState } from "react";

import type {
  SectionConfig,
  FieldConfig,
} from "@/lib/benchmarking/default-field-config";
import {
  evaluateFormula,
  evaluateWarning,
} from "@/lib/benchmarking/default-field-config";
import {
  SectionHeading,
  CurrencyField,
  NumberField,
  TextField,
  TextLongField,
  SelectField,
  BooleanField,
  CalculatedField,
  type SurveySectionProps,
} from "./SurveyFields";
import { matchesShowIf } from "@/lib/benchmarking/show-if";

/**
 * The option that opens the free-text box on an allowOther select.
 *
 * Never stored: choosing it reveals the input, and what they type replaces it.
 * A submission holding this string would mean somebody opened the box and left
 * it empty, which is the same as not answering.
 */
const OTHER_SENTINEL = "Something else";

interface DynamicSurveySectionProps extends SurveySectionProps {
  sectionConfig: SectionConfig;
  /**
   * Rendered under the section heading, above its fields.
   *
   * For the category-driven sections: what a store carries has to come before
   * questions about what it carries, and the heading has to come before both.
   * Putting the grid outside this component got the order right and the
   * heading wrong — the categories appeared above the section title.
   */
  beforeFields?: React.ReactNode;
}

export default function DynamicSurveySection({
  sectionConfig,
  beforeFields,
  ...props
}: DynamicSurveySectionProps) {
  const visibleFields = sectionConfig.fields
    .filter((f) => f.visible !== false)
    .filter((f) => {
      return matchesShowIf(f.showIf, props.formData);
    })
    .sort((a, b) => a.order - b.order);

  // Group fields by their group property for visual grouping
  const groupedFields = groupFields(visibleFields);

  return (
    <div>
      <SectionHeading
        title={`${sectionConfig.order}. ${sectionConfig.title}`}
        description={sectionConfig.description}
      />

      {beforeFields}

      {groupedFields.map((block, blockIdx) => {
        if (block.type === "group") {
          return (
            <div
              key={block.groupName}
              className="border-t border-gray-200 pt-6 mt-6"
            >
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                {block.groupName}
              </h3>
              <div className="space-y-0">
                <FieldList fields={block.fields} {...props} />
              </div>
            </div>
          );
        }

        // Ungrouped fields
        return (
          <div key={`ungrouped-${blockIdx}`}>
            <FieldList fields={block.fields} {...props} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Field Renderer — renders a single field based on its FieldConfig
// ─────────────────────────────────────────────────────────────────

function FieldRenderer({
  field,
  formData,
  priorYearData,
  onFieldChange,
  onDeltaFlag,
  deltaFlags,
  isReadOnly,
  organizationName,
  organizationProvince,
  highlightField,
}: { field: FieldConfig } & SurveySectionProps) {
  const highlighted = highlightField === field.name;
  /*
    Whether the reader has asked for the free-text box on a multiselect.

    Local, not stored: a tick that only reveals an input is not an answer, and
    persisting it would put the words "Something else" into a submission.
  */
  const [wantsOther, setWantsOther] = useState(false);
  const indent = field.indent;
  const indentClass =
    indent === true || indent === 1
      ? "pl-4"
      : typeof indent === "number" && indent >= 2
        ? "pl-8"
        : "";

  // Display-only fields (like institution name from org record)
  if (field.displayOnly) {
    let displayValue: string;
    if (field.name === "organization_name_display") {
      displayValue = organizationName;
    } else if (field.name === "province_display") {
      displayValue = organizationProvince;
    } else {
      displayValue =
        formData[field.name] != null ? String(formData[field.name]) : "—";
    }

    return (
      <div className={`mb-4 ${indentClass}`}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {field.label}
        </label>
        {field.helpText && (
          <p className="text-xs text-gray-500 mb-1">{field.helpText}</p>
        )}
        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900">
          {displayValue}
        </div>
      </div>
    );
  }

  // Calculated fields
  if (field.calculated) {
    const calculatedValue = evaluateFormula(field.calculated.formula, formData);
    const formatMap = {
      currency: "currency" as const,
      number: "number" as const,
      percentage: "percent" as const,
    };

    // Check warnings for this calculated field
    const activeWarnings = (field.warnings ?? []).filter((w) =>
      evaluateWarning(w.condition, formData),
    );

    return (
      <div className={indentClass}>
        <CalculatedField
          label={field.label}
          value={calculatedValue}
          format={formatMap[field.calculated.format]}
          tooltip={field.tooltip}
        />
        {activeWarnings.map((w) => (
          <div
            key={w.condition}
            className="mb-4 -mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800 flex items-center gap-1"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            {w.message}
          </div>
        ))}
        {field.note && (
          <p className="text-xs text-gray-500 -mt-2 mb-4">{field.note}</p>
        )}
      </div>
    );
  }

  // Regular input fields
  const sectionProps: SurveySectionProps = {
    formData,
    priorYearData,
    onFieldChange,
    onDeltaFlag,
    deltaFlags,
    isReadOnly,
    organizationName,
    organizationProvince,
    highlightField,
  };

  /*
    Every field is addressable and can be lit up.

    Needed by two things that had nothing to aim at before: "you missed this
    one" has to scroll to the box rather than just say a name, and the review
    screen's click-through has to land on the answer rather than the top of its
    section.
  */
  const wrapper = (children: React.ReactNode) => (
    <div
      id={`field-${field.name}`}
      className={`${indentClass} scroll-mt-28 rounded-md transition-colors ${
        highlighted ? "bg-amber-50 ring-2 ring-amber-400 ring-offset-2" : ""
      }`}
    >
      {children}
      {field.example && (
        <div className="-mt-2 mb-4 rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Example{field.exampleCredit ? ` \u00b7 ${field.exampleCredit}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-700">{field.example}</p>
        </div>
      )}
      {field.note && (
        <p className="text-xs text-gray-500 -mt-2 mb-4">{field.note}</p>
      )}
    </div>
  );

  switch (field.type) {
    case "currency":
      return wrapper(
        <CurrencyField
          label={field.label}
          field={field.name}
          helpText={field.helpText}
          required={field.required}
          tooltip={field.tooltip}
          {...sectionProps}
        />,
      );

    case "number":
    case "integer":
    case "percentage":
      return wrapper(
        <NumberField
          label={field.label}
          field={field.name}
          helpText={field.helpText}
          required={field.required}
          tooltip={field.tooltip}
          suffix={field.suffix}
          step={field.type === "integer" ? "1" : undefined}
          formData={formData}
          priorYearData={priorYearData}
          onFieldChange={onFieldChange}
          isReadOnly={isReadOnly}
          organizationName={organizationName}
          organizationProvince={organizationProvince}
        />,
      );

    case "text":
      return wrapper(
        <TextField
          label={field.label}
          field={field.name}
          helpText={field.helpText}
          required={field.required}
          tooltip={field.tooltip}
          placeholder={field.placeholder}
          formData={formData}
          onFieldChange={onFieldChange}
          isReadOnly={isReadOnly}
        />,
      );

    case "text_long":
      return wrapper(
        <TextLongField
          label={field.label}
          field={field.name}
          helpText={field.helpText}
          required={field.required}
          tooltip={field.tooltip}
          placeholder={field.placeholder}
          formData={formData}
          onFieldChange={onFieldChange}
          isReadOnly={isReadOnly}
        />,
      );

    case "select": {
      const listed = field.options ?? [];
      const current = formData[field.name];
      /*
        An answer the store typed itself, rather than one of ours.

        The pattern this replaces was an "Other" option plus a companion text
        field, which meant two questions for one answer, two columns to read,
        and — for the four §9 system fields — a companion column that was
        declared here but never actually minted, so the typed answer had
        nowhere to go at all.
      */
      const typedIn =
        typeof current === "string" && current !== "" && !listed.includes(current)
          ? current
          : null;
      /*
        The box appears only once they ask for it.

        Offering a free-text field under every dropdown made the dropdown look
        optional and put a second empty box on screen for every question. It is
        an option in the list now, so choosing it is what opens the box.
      */
      const options = [
        ...listed,
        ...(typedIn ? [typedIn] : []),
        ...(field.allowOther ? [OTHER_SENTINEL] : []),
      ].map((opt) => ({ value: opt, label: opt }));

      // Shown while the sentinel is selected OR while an off-list answer stands,
      // so they can edit what they typed instead of retyping it.
      const askingForOther = current === OTHER_SENTINEL || typedIn !== null;

      return wrapper(
        <div>
          <SelectField
            label={field.label}
            field={field.name}
            options={options}
            helpText={field.helpText}
            required={field.required}
            tooltip={field.tooltip}
            formData={formData}
            onFieldChange={onFieldChange}
            isReadOnly={isReadOnly}
          />
          {askingForOther && !isReadOnly && (
            <input
              type="text"
              autoFocus
              placeholder="Type it and press Enter"
              aria-label={`${field.label}: something else`}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              defaultValue={typedIn ?? ""}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (!v) return;
                onFieldChange(field.name, v);
              }}
              onBlur={(e) => {
                // Typed but never confirmed with Enter. Keeping it is kinder
                // than discarding what they wrote. Empty clears the sentinel so
                // no submission ever stores the words "Something else".
                const v = e.currentTarget.value.trim();
                onFieldChange(field.name, v || null);
              }}
            />
          )}
        </div>,
      );
    }

    case "multiselect": {
      // text[] column. Checkboxes rather than a comma-separated text box: the
      // free-text version could not be saved at all (Postgres rejected the
      // string as a malformed array literal), and even when it saved it
      // produced "Instagram, TikTok" next to "IG/TT" next to "instagram" —
      // three spellings of one answer, which is the same class of damage the
      // combined-sales field did in 2025.
      const selected: string[] = Array.isArray(formData[field.name])
        ? (formData[field.name] as string[])
        : [];
      const extras = selected.filter((v) => !(field.options ?? []).includes(v));
      const toggle = (opt: string) => {
        if (isReadOnly) return;
        const next = selected.includes(opt)
          ? selected.filter((v) => v !== opt)
          : [...selected, opt];
        onFieldChange(field.name, next);
      };

      return wrapper(
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {field.label}
            {field.required && <span className="text-red-600"> *</span>}
          </label>
          {field.helpText && (
            <p className="mt-1 text-sm text-gray-500">{field.helpText}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {(field.options ?? []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  disabled={isReadOnly}
                />
                {opt}
              </label>
            ))}
          </div>

          {/*
            Anything the store picked that is not on the list — either typed
            here, or carried over from 2025 when this was a free-text field.
            Shown as removable chips rather than hidden, because silently
            dropping a store's own answer is how you lose the tail that made
            these lists in the first place.
          */}
          {extras.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {extras.map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-800"
                >
                  {opt}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => toggle(opt)}
                      aria-label={`Remove ${opt}`}
                      className="text-gray-500 hover:text-gray-900"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/*
            One more checkbox, which opens the box. A permanently visible text
            field under every list made the list look optional and left an empty
            input on screen for every question on the page.
          */}
          {!isReadOnly && (
            <label className="mt-2 flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={wantsOther}
                onChange={() => setWantsOther((v) => !v)}
              />
              Something else
            </label>
          )}
          {!isReadOnly && wantsOther && (
            <input
              type="text"
              autoFocus
              placeholder="Type it and press Enter"
              aria-label={`${field.label}: something else`}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (!v || selected.includes(v)) return;
                onFieldChange(field.name, [...selected, v]);
                e.currentTarget.value = "";
              }}
            />
          )}
        </div>,
      );
    }

    case "boolean":
      return wrapper(
        <BooleanField
          label={field.label}
          field={field.name}
          helpText={field.helpText}
          tooltip={field.tooltip}
          formData={formData}
          onFieldChange={onFieldChange}
          isReadOnly={isReadOnly}
        />,
      );

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Grouping helper — organizes fields into sequential blocks
// ─────────────────────────────────────────────────────────────────

type FieldBlock =
  | { type: "ungrouped"; fields: FieldConfig[] }
  | { type: "group"; groupName: string; fields: FieldConfig[] };

/**
 * Lay out a list of fields, keeping same-`row` fields on one line.
 *
 * A fiscal year end is ONE question that happens to need two controls; giving
 * each its own full-width row made "Smarch 32" look like two unrelated
 * questions. Consecutive fields sharing a `row` value are collected and drawn
 * side by side under a single caption.
 */
function FieldList({
  fields,
  ...props
}: { fields: FieldConfig[] } & SurveySectionProps) {
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < fields.length) {
    const field = fields[i];
    if (!field.row) {
      out.push(<FieldRenderer key={field.name} field={field} {...props} />);
      i += 1;
      continue;
    }

    const row = field.row;
    const members: FieldConfig[] = [];
    while (i < fields.length && fields[i].row === row) {
      members.push(fields[i]);
      i += 1;
    }

    const lead = members[0];
    out.push(
      <div key={`row-${row}`} className="mb-4">
        {lead.rowLabel && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lead.rowLabel}
          </label>
        )}
        {lead.rowHelpText && (
          <p className="text-xs text-gray-500 mb-1 whitespace-pre-line">
            {lead.rowHelpText}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {members.map((m) => (
            <div key={m.name} className="min-w-[8rem] flex-1">
              <FieldRenderer field={m} {...props} />
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return <>{out}</>;
}

function groupFields(fields: FieldConfig[]): FieldBlock[] {
  const blocks: FieldBlock[] = [];
  let currentGroup: string | null = null;
  let currentBlock: FieldConfig[] = [];

  for (const field of fields) {
    const fieldGroup = field.group ?? null;

    if (fieldGroup !== currentGroup) {
      // Flush current block
      if (currentBlock.length > 0) {
        blocks.push(
          currentGroup
            ? { type: "group", groupName: currentGroup, fields: currentBlock }
            : { type: "ungrouped", fields: currentBlock },
        );
      }
      currentGroup = fieldGroup;
      currentBlock = [field];
    } else {
      currentBlock.push(field);
    }
  }

  // Flush remaining
  if (currentBlock.length > 0) {
    blocks.push(
      currentGroup
        ? { type: "group", groupName: currentGroup, fields: currentBlock }
        : { type: "ungrouped", fields: currentBlock },
    );
  }

  return blocks;
}
