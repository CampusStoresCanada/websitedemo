"use client";

import { useState } from "react";

/**
 * Controlled add/remove chip-list editor over a string[] — no internal
 * persistence. Extracted from components/admin/policy/PolicyValueEditor.tsx,
 * which autosaved on every add/remove (fine for that single-field editor,
 * but wrong for a form with a single "Save" button covering multiple
 * fields at once — see components/admin/hero-area/HeroAreaForm.tsx).
 * Callers that want autosave-per-change can just call their own save
 * function from onChange, as PolicyValueEditor now does.
 */
export default function StringArrayEditor({
  items,
  onChange,
  disabled = false,
  placeholder = "Add item...",
}: {
  items: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [newItem, setNewItem] = useState("");

  function addItem() {
    if (!newItem.trim()) return;
    onChange([...items, newItem.trim()]);
    setNewItem("");
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
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
              disabled={disabled}
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
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 border border-[var(--border-default)] rounded px-2 py-1 text-xs"
        />
        <button
          onClick={addItem}
          disabled={disabled || !newItem.trim()}
          className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}
