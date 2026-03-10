"use client";

import { useState, useCallback } from "react";
import type { DeltaFlag } from "@/lib/database.types";
import FieldTooltip from "./FieldTooltip";

// ─────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────

export interface SurveySectionProps {
  formData: Record<string, unknown>;
  priorYearData: Record<string, unknown> | null;
  onFieldChange: (field: string, value: string | number | boolean | null) => void;
  onDeltaFlag: (
    fieldName: string,
    previousValue: number | null,
    currentValue: number | null,
    action: "fixed" | "explained",
    explanation?: string
  ) => Promise<void>;
  deltaFlags: DeltaFlag[];
  isReadOnly: boolean;
  organizationName: string;
  organizationProvince: string;
}

// ─────────────────────────────────────────────────────────────────
// Format Helpers
// ─────────────────────────────────────────────────────────────────

/** Format a number as CAD currency (no decimals for display) */
export function formatCurrency(value: unknown): string {
  const num = Number(value);
  if (isNaN(num) || value === null || value === undefined || value === "") return "";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(num);
}

/** Format as plain comma-separated number */
export function formatNumber(value: unknown): string {
  const num = Number(value);
  if (isNaN(num) || value === null || value === undefined || value === "") return "";
  return new Intl.NumberFormat("en-CA").format(num);
}

/** Parse a currency string back to number (strips $, commas, spaces) */
function parseCurrencyInput(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const num = Number(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

/** Parse a percentage string (strips %) */
function parsePercentInput(value: string): number | null {
  const cleaned = value.replace(/%/g, "").trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

// ─────────────────────────────────────────────────────────────────
// Client-side Smart Format Detection
// ─────────────────────────────────────────────────────────────────

/**
 * Detects if a percentage value is ambiguous.
 * When someone enters a value between 0 and 1 exclusive (e.g., 0.87),
 * they might mean 87% or 0.87%. We should ask.
 */
function isAmbiguousPercentage(value: number): boolean {
  return value > 0 && value < 1;
}

/**
 * Check if a currency input looks like it might have formatting issues.
 * Returns a warning message if the input is suspicious.
 */
function checkCurrencyFormat(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Check for percentage symbols in a currency field
  if (trimmed.includes("%")) {
    return "This is a dollar amount field. Did you mean to enter a number without the % sign?";
  }

  // Check for multiple decimal points
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  const decimalCount = (cleaned.match(/\./g) || []).length;
  if (decimalCount > 1) {
    return "Invalid format: multiple decimal points detected. Please enter a valid dollar amount.";
  }

  // Check for non-numeric characters (excluding $, commas, decimals, negatives, spaces)
  const stripped = cleaned.replace(/[0-9.\-]/g, "");
  if (stripped.length > 0) {
    return `Unexpected characters detected: "${stripped}". Please enter a valid dollar amount.`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Currency Field
// ─────────────────────────────────────────────────────────────────

export function CurrencyField({
  label,
  field,
  formData,
  priorYearData,
  onFieldChange,
  onDeltaFlag,
  deltaFlags,
  isReadOnly,
  helpText,
  required,
  tooltip,
}: {
  label: string;
  field: string;
  helpText?: string;
  required?: boolean;
  tooltip?: string;
} & SurveySectionProps) {
  const currentValue = formData[field];
  const priorValue = priorYearData?.[field];
  const [localValue, setLocalValue] = useState(
    currentValue != null ? String(currentValue) : ""
  );
  const [showDeltaAlert, setShowDeltaAlert] = useState(false);
  const [deltaExplanation, setDeltaExplanation] = useState("");
  const [formatWarning, setFormatWarning] = useState<string | null>(null);

  const existingFlag = deltaFlags.find((f) => f.field_name === field);

  const handleBlur = useCallback(() => {
    // 1. Client-side format check
    const warning = checkCurrencyFormat(localValue);
    if (warning) {
      setFormatWarning(warning);
      // Still parse and save what we can, but show the warning
    } else {
      setFormatWarning(null);
    }

    // 2. Parse the value
    const numValue = parseCurrencyInput(localValue);

    // 3. Reformat the local display to canonical form (clean number)
    if (numValue !== null) {
      setLocalValue(String(numValue));
    }

    // 4. Propagate to parent (triggers server save)
    onFieldChange(field, numValue);

    // 5. Check for big delta (±30% AND >$50K)
    if (priorValue != null && numValue != null) {
      const prev = Number(priorValue);
      const curr = numValue;
      if (prev !== 0) {
        const pctChange = Math.abs((curr - prev) / prev) * 100;
        const absChange = Math.abs(curr - prev);
        if (pctChange > 30 && absChange > 50000) {
          setShowDeltaAlert(true);
          return;
        }
      }
      // New value when prior was 0
      if (prev === 0 && curr !== 0 && Math.abs(curr) > 50000) {
        setShowDeltaAlert(true);
        return;
      }
    }
    setShowDeltaAlert(false);
  }, [field, localValue, onFieldChange, priorValue]);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 text-sm">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={localValue}
              onChange={(e) => {
                setLocalValue(e.target.value);
                setFormatWarning(null); // Clear warning on type
              }}
              onBlur={handleBlur}
              disabled={isReadOnly}
              className={`w-full pl-7 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#D60001] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 text-sm ${
                formatWarning ? "border-amber-400" : "border-gray-300"
              }`}
              placeholder="0.00"
            />
          </div>
          {formatWarning && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {formatWarning}
            </p>
          )}
        </div>
        {priorValue != null && (
          <div className="text-xs text-gray-400 pt-2 whitespace-nowrap">
            FY{Number(formData.fiscal_year) - 1}: {formatCurrency(priorValue)}
          </div>
        )}
      </div>

      {/* Existing flag display */}
      {existingFlag && !showDeltaAlert && (
        <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-800">
          <span className="font-medium">Explanation provided:</span>{" "}
          {existingFlag.respondent_explanation}
        </div>
      )}

      {/* Delta flag alert */}
      {showDeltaAlert && !isReadOnly && (
        <DeltaFlagAlert
          field={field}
          priorValue={Number(priorValue ?? 0)}
          currentValue={parseCurrencyInput(localValue) ?? 0}
          explanation={deltaExplanation}
          onExplanationChange={setDeltaExplanation}
          onFix={() => {
            setLocalValue(priorValue != null ? String(priorValue) : "");
            onFieldChange(field, priorValue != null ? Number(priorValue) : null);
            onDeltaFlag(field, Number(priorValue ?? 0), Number(priorValue ?? 0), "fixed");
            setShowDeltaAlert(false);
          }}
          onExplain={async () => {
            await onDeltaFlag(
              field,
              Number(priorValue ?? 0),
              parseCurrencyInput(localValue),
              "explained",
              deltaExplanation
            );
            setShowDeltaAlert(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Number Field
// ─────────────────────────────────────────────────────────────────

export function NumberField({
  label,
  field,
  formData,
  priorYearData,
  onFieldChange,
  isReadOnly,
  helpText,
  required,
  step,
  suffix,
  tooltip,
}: {
  label: string;
  field: string;
  helpText?: string;
  required?: boolean;
  step?: string;
  suffix?: string;
  tooltip?: string;
} & Omit<SurveySectionProps, "onDeltaFlag" | "deltaFlags">) {
  const currentValue = formData[field];
  const priorValue = priorYearData?.[field];
  const [localValue, setLocalValue] = useState(
    currentValue != null ? String(currentValue) : ""
  );
  const [formatWarning, setFormatWarning] = useState<string | null>(null);

  // Determine if this is a percentage field based on suffix
  const isPercentageField = suffix === "%";

  const [showPercentPrompt, setShowPercentPrompt] = useState(false);
  const [ambiguousRawValue, setAmbiguousRawValue] = useState<number | null>(null);

  const handleBlur = useCallback(() => {
    setFormatWarning(null);

    if (isPercentageField) {
      // ── Percentage Smart Detection ──
      const num = parsePercentInput(localValue);
      if (num === null) {
        onFieldChange(field, null);
        return;
      }

      // Reject negatives or >100
      if (num < 0) {
        setFormatWarning("Percentages cannot be negative.");
        onFieldChange(field, null);
        return;
      }
      if (num > 100) {
        setFormatWarning("Percentages cannot exceed 100%. Did you enter the wrong value?");
        onFieldChange(field, null);
        return;
      }

      // Smart ambiguity: 0 < value < 1 → ask user
      if (isAmbiguousPercentage(num)) {
        setAmbiguousRawValue(num);
        setShowPercentPrompt(true);
        // Don't save yet — wait for user choice
        return;
      }

      setLocalValue(String(num));
      onFieldChange(field, num);
    } else {
      // ── Regular Number ──
      const val = localValue.trim();
      if (val === "") {
        onFieldChange(field, null);
        return;
      }
      const num = Number(val.replace(/,/g, ""));
      if (isNaN(num)) {
        setFormatWarning("Please enter a valid number.");
        return;
      }
      onFieldChange(field, num);
    }
  }, [field, localValue, onFieldChange, isPercentageField]);

  // Handle the percentage ambiguity resolution
  const resolvePercentAmbiguity = useCallback(
    (interpretAsWhole: boolean) => {
      if (ambiguousRawValue === null) return;

      // If they said "yes it's 87%", multiply by 100
      // If they said "no, it's 0.87%", keep as-is
      const finalValue = interpretAsWhole
        ? Math.round(ambiguousRawValue * 10000) / 100 // 0.87 → 87.00
        : ambiguousRawValue;

      setLocalValue(String(finalValue));
      onFieldChange(field, finalValue);
      setShowPercentPrompt(false);
      setAmbiguousRawValue(null);
    },
    [ambiguousRawValue, field, onFieldChange]
  );

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <div className="flex items-start gap-3">
        <div className="flex-1 relative">
          <input
            type="number"
            inputMode="decimal"
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              setFormatWarning(null);
              setShowPercentPrompt(false);
            }}
            onBlur={handleBlur}
            step={step || "1"}
            disabled={isReadOnly}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#D60001] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 text-sm ${
              formatWarning ? "border-amber-400" : "border-gray-300"
            }`}
            placeholder="0"
          />
          {suffix && (
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 text-xs">
              {suffix}
            </span>
          )}
        </div>
        {priorValue != null && (
          <div className="text-xs text-gray-400 pt-2 whitespace-nowrap">
            FY{Number(formData.fiscal_year) - 1}: {formatNumber(priorValue)}
            {isPercentageField && "%"}
          </div>
        )}
      </div>

      {/* Format warning */}
      {formatWarning && (
        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {formatWarning}
        </p>
      )}

      {/* ── Percentage Ambiguity Prompt ── */}
      {showPercentPrompt && ambiguousRawValue !== null && (
        <div className="mt-2 bg-blue-50 border border-blue-300 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">
                Quick clarification
              </p>
              <p className="text-xs text-blue-700 mt-1">
                You entered <strong>{ambiguousRawValue}</strong>. Did you mean:
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => resolvePercentAmbiguity(true)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  {Math.round(ambiguousRawValue * 10000) / 100}%
                </button>
                <button
                  type="button"
                  onClick={() => resolvePercentAmbiguity(false)}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50"
                >
                  {ambiguousRawValue}%
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Text Field
// ─────────────────────────────────────────────────────────────────

export function TextField({
  label,
  field,
  formData,
  onFieldChange,
  isReadOnly,
  helpText,
  required,
  placeholder,
  maxLength,
  tooltip,
}: {
  label: string;
  field: string;
  helpText?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  tooltip?: string;
} & Pick<SurveySectionProps, "formData" | "onFieldChange" | "isReadOnly">) {
  const currentValue = formData[field];
  const [localValue, setLocalValue] = useState(
    currentValue != null ? String(currentValue) : ""
  );
  const limit = maxLength ?? 500;
  const isNearLimit = localValue.length > limit * 0.9;

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <input
        type="text"
        value={localValue}
        onChange={(e) => {
          if (e.target.value.length <= limit) {
            setLocalValue(e.target.value);
          }
        }}
        onBlur={() => onFieldChange(field, localValue.trim() || null)}
        disabled={isReadOnly}
        placeholder={placeholder}
        maxLength={limit}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D60001] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 text-sm"
      />
      {isNearLimit && (
        <p className="text-xs text-gray-400 mt-1 text-right">
          {localValue.length}/{limit}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Text Long Field (textarea)
// ─────────────────────────────────────────────────────────────────

export function TextLongField({
  label,
  field,
  formData,
  onFieldChange,
  isReadOnly,
  helpText,
  required,
  placeholder,
  maxLength,
  tooltip,
}: {
  label: string;
  field: string;
  helpText?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  tooltip?: string;
} & Pick<SurveySectionProps, "formData" | "onFieldChange" | "isReadOnly">) {
  const currentValue = formData[field];
  const [localValue, setLocalValue] = useState(
    currentValue != null ? String(currentValue) : ""
  );
  const limit = maxLength ?? 2000;
  const isNearLimit = localValue.length > limit * 0.9;

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <textarea
        value={localValue}
        onChange={(e) => {
          if (e.target.value.length <= limit) {
            setLocalValue(e.target.value);
          }
        }}
        onBlur={() => onFieldChange(field, localValue.trim() || null)}
        disabled={isReadOnly}
        placeholder={placeholder}
        maxLength={limit}
        rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D60001] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 text-sm"
      />
      {isNearLimit && (
        <p className="text-xs text-gray-400 mt-1 text-right">
          {localValue.length}/{limit}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Select Field
// ─────────────────────────────────────────────────────────────────

export function SelectField({
  label,
  field,
  options,
  formData,
  onFieldChange,
  isReadOnly,
  helpText,
  required,
  tooltip,
}: {
  label: string;
  field: string;
  options: { value: string; label: string }[];
  helpText?: string;
  required?: boolean;
  tooltip?: string;
} & Pick<SurveySectionProps, "formData" | "onFieldChange" | "isReadOnly">) {
  const currentValue = formData[field] != null ? String(formData[field]) : "";

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <select
        value={currentValue}
        onChange={(e) => onFieldChange(field, e.target.value || null)}
        disabled={isReadOnly}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D60001] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 text-sm"
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Boolean Field (Yes/No)
// ─────────────────────────────────────────────────────────────────

export function BooleanField({
  label,
  field,
  formData,
  onFieldChange,
  isReadOnly,
  helpText,
  tooltip,
}: {
  label: string;
  field: string;
  helpText?: string;
  tooltip?: string;
} & Pick<SurveySectionProps, "formData" | "onFieldChange" | "isReadOnly">) {
  const currentValue = formData[field];

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onFieldChange(field, true)}
          disabled={isReadOnly}
          className={`px-4 py-1.5 rounded-lg text-sm border ${
            currentValue === true
              ? "bg-[#D60001] text-white border-[#D60001]"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onFieldChange(field, false)}
          disabled={isReadOnly}
          className={`px-4 py-1.5 rounded-lg text-sm border ${
            currentValue === false
              ? "bg-[#D60001] text-white border-[#D60001]"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          No
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Calculated Field (read-only)
// ─────────────────────────────────────────────────────────────────

export function CalculatedField({
  label,
  value,
  format = "currency",
  tooltip,
}: {
  label: string;
  value: number | null;
  format?: "currency" | "number" | "percent";
  tooltip?: string;
}) {
  let display = "—";
  if (value != null && !isNaN(value)) {
    if (format === "currency") display = formatCurrency(value);
    else if (format === "percent") display = `${value.toFixed(1)}%`;
    else display = formatNumber(value);
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {tooltip && <FieldTooltip text={tooltip} />}
      </label>
      <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 font-medium">
        {display}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Section Heading
// ─────────────────────────────────────────────────────────────────

export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description && (
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Delta Flag Alert
// ─────────────────────────────────────────────────────────────────

function DeltaFlagAlert({
  field,
  priorValue,
  currentValue,
  explanation,
  onExplanationChange,
  onFix,
  onExplain,
}: {
  field: string;
  priorValue: number;
  currentValue: number;
  explanation: string;
  onExplanationChange: (v: string) => void;
  onFix: () => void;
  onExplain: () => Promise<void>;
}) {
  const pctChange =
    priorValue !== 0
      ? (((currentValue - priorValue) / priorValue) * 100).toFixed(0)
      : "N/A";

  return (
    <div className="mt-2 bg-amber-50 border border-amber-300 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-800">
            Large change detected ({pctChange}% from prior year)
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Prior year: {formatCurrency(priorValue)} → Current: {formatCurrency(currentValue)}
          </p>
          <div className="mt-3 space-y-2">
            <textarea
              value={explanation}
              onChange={(e) => {
                if (e.target.value.length <= 2000) {
                  onExplanationChange(e.target.value);
                }
              }}
              placeholder="Please explain the reason for this change..."
              className="w-full px-3 py-2 text-sm border border-amber-300 rounded focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              rows={2}
              maxLength={2000}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onFix}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Let me fix that
              </button>
              <button
                type="button"
                onClick={onExplain}
                disabled={!explanation.trim()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded hover:bg-amber-700 disabled:opacity-50"
              >
                Yes, this is correct
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
