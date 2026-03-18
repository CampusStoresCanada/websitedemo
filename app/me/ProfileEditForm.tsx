"use client";

import { useState } from "react";
import { updateProfile } from "@/lib/actions/profile";

interface Props {
  displayName: string;
  roleTitle: string;
}

export default function ProfileEditForm({ displayName, roleTitle }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [title, setTitle] = useState(roleTitle);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateProfile({ display_name: name, role_title: title });
    setSaving(false);
    if (result.success) {
      setMessage({ ok: true, text: "Profile updated." });
      setEditing(false);
    } else {
      setMessage({ ok: false, text: result.error ?? "Failed to save." });
    }
  }

  if (!editing) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => { setEditing(true); setMessage(null); }}
          className="text-sm text-[#EE2A2E] hover:text-[#D92327]"
        >
          Edit profile
        </button>
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700">Display Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Role / Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Store Manager"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
        />
        <p className="mt-1 text-xs text-gray-500">Appears as your headline in Circle.</p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-4 py-2 rounded-md bg-[#EE2A2E] text-white text-sm font-medium hover:bg-[#D92327] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setName(displayName); setTitle(roleTitle); setMessage(null); }}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-600" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
