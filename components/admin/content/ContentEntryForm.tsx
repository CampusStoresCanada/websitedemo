"use client";

import { useState } from "react";
import type { SiteContent } from "@/lib/database.types";

interface ContentEntryFormProps {
  /** Existing entry to edit, or undefined for new entry */
  entry?: SiteContent;
  section: string;
  onSave: (data: {
    title: string;
    subtitle: string;
    body: string;
    image_url: string;
    display_order: number;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function ContentEntryForm({
  entry,
  section,
  onSave,
  onCancel,
}: ContentEntryFormProps) {
  const [title, setTitle] = useState(entry?.title || "");
  const [subtitle, setSubtitle] = useState(entry?.subtitle || "");
  const [body, setBody] = useState(entry?.body || "");
  const [imageUrl, setImageUrl] = useState(entry?.image_url || "");
  const [displayOrder, setDisplayOrder] = useState(entry?.display_order ?? 0);
  const [saving, setSaving] = useState(false);

  const label =
    section === "board_of_directors" ? "Board Member" : "Staff Member";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        title,
        subtitle,
        body,
        image_url: imageUrl,
        display_order: displayOrder,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-[#E5E5E5] rounded-xl p-6 space-y-4"
    >
      <h3 className="font-semibold text-[#1A1A1A]">
        {entry ? `Edit ${label}` : `Add ${label}`}
      </h3>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-[#4A4A4A] mb-1">
          Name
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
          placeholder="Jane Smith"
        />
      </div>

      {/* Role/Title */}
      <div>
        <label className="block text-sm font-medium text-[#4A4A4A] mb-1">
          Role / Title
        </label>
        <input
          type="text"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
          placeholder="Chair, Board of Directors"
        />
      </div>

      {/* Bio */}
      <div>
        <label className="block text-sm font-medium text-[#4A4A4A] mb-1">
          Bio (optional)
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] resize-none"
          placeholder="Brief bio…"
        />
      </div>

      {/* Image URL */}
      <div>
        <label className="block text-sm font-medium text-[#4A4A4A] mb-1">
          Photo URL (optional)
        </label>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
          placeholder="https://…"
        />
      </div>

      {/* Display Order */}
      <div>
        <label className="block text-sm font-medium text-[#4A4A4A] mb-1">
          Display Order
        </label>
        <input
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
          className="w-24 h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="px-4 py-2 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : entry ? "Update" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[#6B6B6B] text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
