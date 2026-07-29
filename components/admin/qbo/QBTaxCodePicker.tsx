"use client";

import { useEffect, useState } from "react";

interface QBTaxCode {
  Id: string;
  Name: string;
  Description?: string;
}

interface QBTaxCodePickerProps {
  value: string | null;
  onChange: (taxCodeId: string | null, taxCodeName: string | null) => void;
  label?: string;
  required?: boolean;
}

export default function QBTaxCodePicker({
  value,
  onChange,
  label = "QuickBooks Tax Code",
  required = false,
}: QBTaxCodePickerProps) {
  const [codes, setCodes] = useState<QBTaxCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadCodes = async () => {
    if (loaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/qbo/tax-codes");
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to load QB tax codes");
      }
      const data: QBTaxCode[] = await res.json();
      setCodes(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QB tax codes");
    } finally {
      setLoading(false);
    }
  };

  // Same eager-load-when-a-value-exists fix as QBItemPicker — otherwise a
  // saved value renders as unlinked until the select is focused once.
  useEffect(() => {
    if (value) loadCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCode = codes.find((c) => c.Id === value);

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <select
        value={value ?? ""}
        onFocus={loadCodes}
        onChange={(e) => {
          const selectedId = e.target.value || null;
          const selectedName = codes.find((c) => c.Id === selectedId)?.Name ?? null;
          onChange(selectedId, selectedName);
        }}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
        required={required}
      >
        <option value="">{loading ? "Loading QB tax codes…" : "— No tax code linked —"}</option>
        {codes.map((code) => (
          <option key={code.Id} value={code.Id}>
            {code.Name}
          </option>
        ))}
      </select>

      {error && (
        <p className="mt-1 text-xs text-red-600">
          {error} — check that QB integration is configured.
        </p>
      )}

      {!value && !required && (
        <p className="mt-1 text-[11px] text-amber-600">
          No tax code linked. QBO requires one on every sale — exports will fail until set.
        </p>
      )}

      {value && selectedCode && (
        <p className="mt-1 text-[11px] text-gray-500">
          Linked: {selectedCode.Name} (ID: {value})
        </p>
      )}

      {value && !selectedCode && loaded && (
        <p className="mt-1 text-[11px] text-amber-600">
          Previously linked tax code (ID: {value}) not found in QB — may have been deleted.
        </p>
      )}
    </div>
  );
}
