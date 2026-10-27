"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";

/**
 * A document agreed to inside its own checklist row.
 *
 * Records through acceptLegalDocument, the one way a conference document is
 * accepted, so it lands in legal_acceptances against this exact version with
 * the person's own login and the time. That row is the record CSC can point to,
 * and it is also how the checklist sees the task is done.
 *
 * ⛔ An explicit tick, then a button. A single "I agree" button is one
 * mis-click from consent; the checkbox makes the person say it in words first.
 */
export default function AgreeToDocument({
  versionId,
  title,
  content,
}: {
  versionId: string;
  title: string;
  content: string;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    setSaving(true);
    setError(null);
    const result = await acceptLegalDocument(versionId);
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "That didn't save. Please try again.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <div
        className="prose prose-sm mt-1 max-h-56 max-w-none overflow-y-auto text-sm text-gray-700"
        dangerouslySetInnerHTML={{ __html: content }}
      />
      <label className="mt-3 flex items-start gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(event) => setTicked(event.target.checked)}
          className="mt-0.5"
        />
        <span>I have read this and I agree.</span>
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={agree}
        disabled={!ticked || saving}
        className="mt-2 rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#12325a] disabled:opacity-50"
      >
        {saving ? "Saving…" : "Agree"}
      </button>
    </div>
  );
}
