"use client";

import { useState, useMemo } from "react";

interface Organization {
  id: string;
  name: string;
  type?: string;
}

interface OrgMultiSelectProps {
  organizations: Organization[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelections?: number;
  label: string;
  description?: string;
}

export default function OrgMultiSelect({
  organizations,
  selected,
  onChange,
  maxSelections,
  label,
  description,
}: OrgMultiSelectProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return organizations;
    const q = search.toLowerCase();
    return organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(q) ||
        org.type?.toLowerCase().includes(q)
    );
  }, [organizations, search]);

  const toggle = (orgId: string) => {
    if (selected.includes(orgId)) {
      onChange(selected.filter((id) => id !== orgId));
    } else {
      if (maxSelections && selected.length >= maxSelections) return;
      onChange([...selected, orgId]);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {description && (
        <p className="text-xs text-gray-500 mb-2">{description}</p>
      )}

      {/* Selection count */}
      <div className="text-xs text-gray-500 mb-2">
        {selected.length} selected
        {maxSelections ? ` (max ${maxSelections})` : ""}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search organizations..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
      />

      {/* List */}
      <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-400 text-center">
            No organizations found
          </div>
        ) : (
          filtered.map((org) => {
            const isSelected = selected.includes(org.id);
            const isDisabled =
              !isSelected && !!maxSelections && selected.length >= maxSelections;

            return (
              <label
                key={org.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                  isDisabled ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => toggle(org.id)}
                  className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-900 truncate block">
                    {org.name}
                  </span>
                  {org.type && (
                    <span className="text-xs text-gray-500">{org.type}</span>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
