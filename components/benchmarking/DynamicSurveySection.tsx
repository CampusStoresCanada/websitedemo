"use client";

import type { SectionConfig, FieldConfig } from "@/lib/benchmarking/default-field-config";
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

interface DynamicSurveySectionProps extends SurveySectionProps {
  sectionConfig: SectionConfig;
}

export default function DynamicSurveySection({
  sectionConfig,
  ...props
}: DynamicSurveySectionProps) {
  const visibleFields = sectionConfig.fields
    .filter((f) => f.visible !== false)
    .filter((f) => {
      if (!f.showIf) return true;
      return props.formData[f.showIf.field] === f.showIf.value;
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
                {block.fields.map((field) => (
                  <FieldRenderer
                    key={field.name}
                    field={field}
                    {...props}
                  />
                ))}
              </div>
            </div>
          );
        }

        // Ungrouped fields
        return (
          <div key={`ungrouped-${blockIdx}`}>
            {block.fields.map((field) => (
              <FieldRenderer
                key={field.name}
                field={field}
                {...props}
              />
            ))}
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
}: { field: FieldConfig } & SurveySectionProps) {
  const indent = field.indent;
  const indentClass = indent === true || indent === 1
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
      displayValue = formData[field.name] != null ? String(formData[field.name]) : "—";
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
      evaluateWarning(w.condition, formData)
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
            <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
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
  };

  const wrapper = (children: React.ReactNode) => (
    <div className={indentClass}>
      {children}
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
        />
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
        />
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
        />
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
        />
      );

    case "select": {
      const options = (field.options ?? []).map((opt) => ({
        value: opt,
        label: opt,
      }));
      return wrapper(
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
        />
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
            : { type: "ungrouped", fields: currentBlock }
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
        : { type: "ungrouped", fields: currentBlock }
    );
  }

  return blocks;
}
