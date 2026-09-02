"use client";

import { useState } from "react";
import { saveIntroNote } from "@/lib/actions/benchmarking-intro-note";

/**
 * Where the committee lead writes their part of the survey's opening page.
 *
 * Sits in the committee console rather than behind an admin content editor,
 * because the person who owns these words is the person who chairs the review
 * — asking them to go and find site_content is how the block stays empty.
 *
 * Says plainly that leaving it blank removes it. A chair should be able to
 * decide the page reads better without them this year without needing to ask
 * anyone.
 */
export default function IntroNoteEditor({
  initialTitle,
  initialBody,
  surveyOpensOn,
}: {
  initialTitle: string;
  initialBody: string;
  surveyOpensOn: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await saveIntroNote({ title, body });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Could not save.");
      return;
    }
    setSaved(true);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">
        Your note on the survey&apos;s opening page
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        Every store sees this before they start. The rest of that page is CSC
        explaining the mechanics — this is the part that can say why it matters this
        year, and it comes from the committee rather than from the office.
        {surveyOpensOn ? ` Stores start seeing it on ${surveyOpensOn}.` : ""}
      </p>

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-500">
        Heading
      </label>
      <input
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="From the benchmarking committee"
      />

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-500">
        What you want them to know
      </label>
      <textarea
        className="mt-1 min-h-[140px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="A few sentences. What the committee is trying to learn this year, what changed since last year, or why a particular section is worth the effort."
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[#163D6D] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <span className="text-sm" aria-live="polite">
          {saved && <span className="text-green-700">Saved — it is on the page now.</span>}
          {error && <span className="text-red-700">{error}</span>}
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Leave the note empty to take the block off the page entirely. Nothing appears
        there until you write something.
      </p>
    </section>
  );
}
