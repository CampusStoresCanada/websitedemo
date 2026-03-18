"use client";

import { useEffect, useState } from "react";

interface QBItem {
  Id: string;
  Name: string;
  Type: string;
  UnitPrice?: number;
}

interface QBItemPickerProps {
  value: string | null;
  onChange: (itemId: string | null, itemName: string | null) => void;
  label?: string;
  required?: boolean;
}

export default function QBItemPicker({
  value,
  onChange,
  label = "QuickBooks Item",
  required = false,
}: QBItemPickerProps) {
  const [items, setItems] = useState<QBItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadItems = async () => {
    if (loaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/qbo/items");
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to load QB items");
      }
      const data: QBItem[] = await res.json();
      setItems(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QB items");
    } finally {
      setLoading(false);
    }
  };

  const selectedItem = items.find((item) => item.Id === value);

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <select
        value={value ?? ""}
        onFocus={loadItems}
        onChange={(e) => {
          const selectedId = e.target.value || null;
          const selectedName = items.find((item) => item.Id === selectedId)?.Name ?? null;
          onChange(selectedId, selectedName);
        }}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
        required={required}
      >
        <option value="">{loading ? "Loading QB items…" : "— No QB item linked —"}</option>
        {items.map((item) => (
          <option key={item.Id} value={item.Id}>
            {item.Name}
            {item.UnitPrice != null ? ` ($${item.UnitPrice.toFixed(2)})` : ""}
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
          No QB item linked. Exports for this product will fail until one is selected.
        </p>
      )}

      {value && selectedItem && (
        <p className="mt-1 text-[11px] text-gray-500">
          Linked: {selectedItem.Name} (ID: {value})
        </p>
      )}

      {value && !selectedItem && loaded && (
        <p className="mt-1 text-[11px] text-amber-600">
          Previously linked item (ID: {value}) not found in QB — may have been deleted.
        </p>
      )}
    </div>
  );
}
