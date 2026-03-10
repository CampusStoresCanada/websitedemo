"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PolicyValue } from "@/lib/policy/types";
import { updateDraftValue } from "@/lib/actions/policy";

interface Props {
  value: PolicyValue;
  publishedValue: PolicyValue | null;
  isEditing: boolean;
  draftSetId: string | null;
  hasChanged: boolean;
}

export default function PolicyValueEditor({
  value,
  publishedValue,
  isEditing,
  draftSetId,
  hasChanged,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localValue, setLocalValue] = useState<unknown>(value.value_json);

  // Derive enum options from validation_schema
  const schema = value.validation_schema as Record<string, unknown> | null;
  const enumOptions = schema?.enum as string[] | undefined;
  const min = schema?.minimum as number | undefined;
  const max = schema?.maximum as number | undefined;

  async function handleSave(newVal: unknown) {
    if (!draftSetId) return;
    setError(null);
    setSaving(true);
    const result = await updateDraftValue(draftSetId, value.key, newVal);
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setLocalValue(newVal);
    router.refresh();
  }

  function renderReadOnly() {
    return (
      <span className="text-sm text-[var(--text-primary)]">
        {formatDisplayValue(value.value_json, value.type)}
      </span>
    );
  }

  function renderEditor() {
    if (value.key === "billing.pricing_mode") {
      const options = ["FTE_BUCKETS", "SINGLE_METRIC_BUCKETS", "LINEAR_FORMULA"];
      return (
        <SelectEditor
          value={String(localValue)}
          options={options}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.membership_tiers") {
      return (
        <MembershipTiersEditor
          value={Array.isArray(localValue) ? (localValue as TierRow[]) : []}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.formula_config") {
      const fallback: FormulaConfig = {
        base: 200,
        multiplier: 0.0001,
        min_price: 200,
        max_price: 2000,
        rounding: "nearest_dollar",
      };
      return (
        <FormulaConfigEditor
          value={isFormulaConfig(localValue) ? (localValue as FormulaConfig) : fallback}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.metric_key") {
      const options = [
        "organizations.fte",
        "benchmarking.enrollment_fte",
        "benchmarking.total_sales",
      ];
      return (
        <SelectEditor
          value={String(localValue)}
          options={options}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.fallback_behavior") {
      const options = ["use_fallback_price", "require_manual", "use_highest_tier"];
      return (
        <SelectEditor
          value={String(localValue)}
          options={options}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.rounding_rule") {
      const options = ["nearest_dollar", "floor", "ceil"];
      return (
        <SelectEditor
          value={String(localValue)}
          options={options}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    if (value.key === "billing.override_persistence") {
      const options = ["cycle_only", "until_cleared"];
      return (
        <SelectEditor
          value={String(localValue)}
          options={options}
          onSave={handleSave}
          saving={saving}
        />
      );
    }

    switch (value.type) {
      case "integer":
        return (
          <IntegerEditor
            value={localValue as number}
            min={min}
            max={max}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "decimal":
        return (
          <DecimalEditor
            value={localValue as number}
            min={min}
            max={max}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "string":
        if (enumOptions) {
          return (
            <SelectEditor
              value={localValue as string}
              options={enumOptions}
              onSave={handleSave}
              saving={saving}
            />
          );
        }
        return (
          <StringEditor
            value={localValue as string}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "boolean":
        return (
          <BooleanEditor
            value={localValue as boolean}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "string_array":
        return (
          <StringArrayEditor
            value={localValue as string[]}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "integer_array":
        return (
          <IntegerArrayEditor
            value={localValue as number[]}
            onSave={handleSave}
            saving={saving}
          />
        );
      case "json":
        return (
          <JsonEditor
            value={localValue}
            onSave={handleSave}
            saving={saving}
          />
        );
      default:
        return (
          <JsonEditor
            value={localValue}
            onSave={handleSave}
            saving={saving}
          />
        );
    }
  }

  return (
    <div
      className={`p-4 border rounded-[var(--radius-md)] transition-colors ${
        hasChanged
          ? "border-amber-300 bg-amber-50/50"
          : "border-[var(--border-subtle)] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {value.label}
            </span>
            {value.is_high_risk && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
                HIGH RISK
              </span>
            )}
            {hasChanged && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                CHANGED
              </span>
            )}
          </div>
          {value.description && (
            <p className="text-xs text-[var(--text-tertiary)] mb-2">
              {value.description}
            </p>
          )}
          <code className="text-[10px] text-[var(--text-tertiary)]">
            {value.key}
          </code>
        </div>

        <div className="flex-shrink-0 w-72">
          {isEditing ? renderEditor() : renderReadOnly()}
          {hasChanged && publishedValue && !isEditing && (
            <div className="text-xs text-amber-600 mt-1">
              Was: {formatDisplayValue(publishedValue.value_json, value.type)}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 text-xs text-red-600">{error}</div>
      )}
    </div>
  );
}

type TierRow = {
  max_fte?: number | null;
  max_value?: number | null;
  price: number;
};

type FormulaConfig = {
  base: number;
  multiplier: number;
  min_price: number;
  max_price: number;
  rounding: "nearest_dollar" | "floor" | "ceil";
};

function isFormulaConfig(value: unknown): value is FormulaConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.base === "number" &&
    typeof candidate.multiplier === "number" &&
    typeof candidate.min_price === "number" &&
    typeof candidate.max_price === "number" &&
    typeof candidate.rounding === "string"
  );
}

// ─── Display Helpers ──────────────────────────────────────────

function formatDisplayValue(val: unknown, type: string): string {
  if (val === null || val === undefined) return "—";
  if (type === "boolean") return val ? "Yes" : "No";
  if (type === "string_array" || type === "integer_array") {
    return (val as unknown[]).join(", ");
  }
  if (type === "json") return JSON.stringify(val, null, 2);
  return String(val);
}

// ─── Sub-Editors ──────────────────────────────────────────────

function IntegerEditor({
  value,
  min,
  max,
  onSave,
  saving,
}: {
  value: number;
  min?: number;
  max?: number;
  onSave: (v: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={val}
        min={min}
        max={max}
        onChange={(e) => setVal(parseInt(e.target.value) || 0)}
        className="w-24 border border-[var(--border-default)] rounded px-2 py-1 text-sm"
      />
      <SaveButton onClick={() => onSave(val)} saving={saving} disabled={val === value} />
    </div>
  );
}

function DecimalEditor({
  value,
  min,
  max,
  onSave,
  saving,
}: {
  value: number;
  min?: number;
  max?: number;
  onSave: (v: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.01"
        value={val}
        min={min}
        max={max}
        onChange={(e) => setVal(parseFloat(e.target.value) || 0)}
        className="w-28 border border-[var(--border-default)] rounded px-2 py-1 text-sm"
      />
      <SaveButton onClick={() => onSave(val)} saving={saving} disabled={val === value} />
    </div>
  );
}

function StringEditor({
  value,
  onSave,
  saving,
}: {
  value: string;
  onSave: (v: string) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="flex-1 border border-[var(--border-default)] rounded px-2 py-1 text-sm"
      />
      <SaveButton onClick={() => onSave(val)} saving={saving} disabled={val === value} />
    </div>
  );
}

function SelectEditor({
  value,
  options,
  onSave,
  saving,
}: {
  value: string;
  options: string[];
  onSave: (v: string) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(value);
  return (
    <div className="flex items-center gap-2">
      <select
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          onSave(e.target.value);
        }}
        disabled={saving}
        className="flex-1 border border-[var(--border-default)] rounded px-2 py-1 text-sm bg-white"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function BooleanEditor({
  value,
  onSave,
  saving,
}: {
  value: boolean;
  onSave: (v: boolean) => void;
  saving: boolean;
}) {
  return (
    <button
      onClick={() => onSave(!value)}
      disabled={saving}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        value ? "bg-green-500" : "bg-gray-300"
      } ${saving ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function StringArrayEditor({
  value,
  onSave,
  saving,
}: {
  value: string[];
  onSave: (v: string[]) => void;
  saving: boolean;
}) {
  const [items, setItems] = useState(value);
  const [newItem, setNewItem] = useState("");

  function addItem() {
    if (!newItem.trim()) return;
    const updated = [...items, newItem.trim()];
    setItems(updated);
    setNewItem("");
    onSave(updated);
  }

  function removeItem(index: number) {
    const updated = items.filter((_, i) => i !== index);
    setItems(updated);
    onSave(updated);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-[var(--text-secondary)]"
          >
            {item}
            <button
              onClick={() => removeItem(i)}
              disabled={saving}
              className="text-gray-400 hover:text-red-500 ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Add item..."
          className="flex-1 border border-[var(--border-default)] rounded px-2 py-1 text-xs"
        />
        <button
          onClick={addItem}
          disabled={saving || !newItem.trim()}
          className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

function IntegerArrayEditor({
  value,
  onSave,
  saving,
}: {
  value: number[];
  onSave: (v: number[]) => void;
  saving: boolean;
}) {
  const [items, setItems] = useState(value);
  const [newItem, setNewItem] = useState("");

  function addItem() {
    const num = parseInt(newItem);
    if (isNaN(num)) return;
    const updated = [...items, num];
    setItems(updated);
    setNewItem("");
    onSave(updated);
  }

  function removeItem(index: number) {
    const updated = items.filter((_, i) => i !== index);
    setItems(updated);
    onSave(updated);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-[var(--text-secondary)]"
          >
            {item}
            <button
              onClick={() => removeItem(i)}
              disabled={saving}
              className="text-gray-400 hover:text-red-500 ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Add..."
          className="w-20 border border-[var(--border-default)] rounded px-2 py-1 text-xs"
        />
        <button
          onClick={addItem}
          disabled={saving || !newItem}
          className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

function JsonEditor({
  value,
  onSave,
  saving,
}: {
  value: unknown;
  onSave: (v: unknown) => void;
  saving: boolean;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function handleSave() {
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      onSave(parsed);
    } catch {
      setParseError("Invalid JSON");
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(8, text.split("\n").length + 1)}
        className="w-full border border-[var(--border-default)] rounded px-2 py-1 text-xs font-mono resize-y"
      />
      {parseError && (
        <div className="text-xs text-red-600">{parseError}</div>
      )}
      <SaveButton
        onClick={handleSave}
        saving={saving}
        disabled={text === JSON.stringify(value, null, 2)}
      />
    </div>
  );
}

function MembershipTiersEditor({
  value,
  onSave,
  saving,
}: {
  value: TierRow[];
  onSave: (v: TierRow[]) => void;
  saving: boolean;
}) {
  const [rows, setRows] = useState<TierRow[]>(value);

  function updateRow(index: number, patch: Partial<TierRow>) {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setRows(next);
  }

  function addRow() {
    setRows((current) => [...current, { max_fte: null, price: 0 }]);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="max-h-48 overflow-y-auto rounded border border-[var(--border-subtle)]">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1 text-left font-medium text-[var(--text-secondary)]">Max</th>
              <th className="px-2 py-1 text-left font-medium text-[var(--text-secondary)]">Price</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-[var(--border-subtle)]">
                <td className="px-2 py-1">
                  <input
                    type="number"
                    value={row.max_fte ?? row.max_value ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const nextValue = raw.length === 0 ? null : Number(raw);
                      if ("max_fte" in row || row.max_fte !== undefined) {
                        updateRow(index, { max_fte: nextValue });
                      } else {
                        updateRow(index, { max_value: nextValue });
                      }
                    }}
                    className="w-20 rounded border border-[var(--border-default)] px-1.5 py-0.5"
                    placeholder="null"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    value={row.price}
                    onChange={(event) => updateRow(index, { price: Number(event.target.value) || 0 })}
                    className="w-20 rounded border border-[var(--border-default)] px-1.5 py-0.5"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-red-600 hover:text-red-700"
                    disabled={saving}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-2 py-2 text-[var(--text-tertiary)]" colSpan={3}>
                  No rows configured.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs hover:bg-gray-50"
          disabled={saving}
        >
          Add row
        </button>
        <SaveButton
          onClick={() => onSave(rows)}
          saving={saving}
          disabled={JSON.stringify(rows) === JSON.stringify(value)}
        />
      </div>
    </div>
  );
}

function FormulaConfigEditor({
  value,
  onSave,
  saving,
}: {
  value: FormulaConfig;
  onSave: (v: FormulaConfig) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState<FormulaConfig>(value);
  const roundingOptions: FormulaConfig["rounding"][] = ["nearest_dollar", "floor", "ceil"];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          step="0.01"
          value={local.base}
          onChange={(event) => setLocal((prev) => ({ ...prev, base: Number(event.target.value) || 0 }))}
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
          placeholder="Base"
        />
        <input
          type="number"
          step="0.0001"
          value={local.multiplier}
          onChange={(event) =>
            setLocal((prev) => ({ ...prev, multiplier: Number(event.target.value) || 0 }))
          }
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
          placeholder="Multiplier"
        />
        <input
          type="number"
          step="0.01"
          value={local.min_price}
          onChange={(event) =>
            setLocal((prev) => ({ ...prev, min_price: Number(event.target.value) || 0 }))
          }
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
          placeholder="Min"
        />
        <input
          type="number"
          step="0.01"
          value={local.max_price}
          onChange={(event) =>
            setLocal((prev) => ({ ...prev, max_price: Number(event.target.value) || 0 }))
          }
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
          placeholder="Max"
        />
      </div>
      <div className="flex items-center gap-2">
        <select
          value={local.rounding}
          onChange={(event) =>
            setLocal((prev) => ({
              ...prev,
              rounding: event.target.value as FormulaConfig["rounding"],
            }))
          }
          className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
        >
          {roundingOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <SaveButton
          onClick={() => onSave(local)}
          saving={saving}
          disabled={JSON.stringify(local) === JSON.stringify(value)}
        />
      </div>
    </div>
  );
}

function SaveButton({
  onClick,
  saving,
  disabled,
}: {
  onClick: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="px-2.5 py-1 text-xs bg-[var(--text-primary)] text-white rounded hover:opacity-90 disabled:opacity-30 transition-opacity"
    >
      {saving ? "..." : "Save"}
    </button>
  );
}
