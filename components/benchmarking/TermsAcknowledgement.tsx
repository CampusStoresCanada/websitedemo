"use client";

import { useState } from "react";
import Link from "next/link";
import { setTermsAcknowledged } from "@/lib/actions/benchmarking-survey";

/**
 * The one affirmative thing on the title page.
 *
 * Everything else here is us telling the store something. This is the store
 * telling us it understood — specifically that aggregate inclusion does not
 * entitle it to full results, which is the part people discover later and feel
 * misled by.
 *
 * It gates the Start button rather than the save. A store can still read the
 * whole page, print the worksheet, and leave. What it cannot do is begin
 * entering figures having skipped past the terms without a word.
 */
export default function TermsAcknowledgement({
  benchmarkingId,
  initialAcknowledged,
  startHref,
  disabledMessage,
}: {
  benchmarkingId: string;
  initialAcknowledged: boolean;
  startHref: string;
  /** Set when the year is sealed — the control is a statement, not a choice. */
  disabledMessage?: string | null;
}) {
  const [checked, setChecked] = useState(initialAcknowledged);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (disabledMessage) return;
    setChecked(next);
    setSaving(true);
    setError(null);
    const res = await setTermsAcknowledged(benchmarkingId, next);
    setSaving(false);
    if (!res.success) {
      // Put it back rather than showing a tick we did not record.
      setChecked(!next);
      setError(res.error ?? "Could not save that.");
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-[#163D6D]/25 bg-[#163D6D]/[0.03] p-5">
      <label className="flex cursor-pointer gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={checked}
          disabled={saving || Boolean(disabledMessage)}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span className="text-sm text-gray-800">
          I have read how these figures are used and protected. I understand that{" "}
          <strong className="font-medium">
            contributing to the aggregate does not entitle my store to the full results
          </strong>{" "}
          — if we choose not to be named, we receive the group figures rather than named
          peer detail — and that a store which does not take part receives no results at
          all.
        </span>
      </label>

      <div className="mt-3 min-h-[20px] text-sm" aria-live="polite">
        {saving && <span className="text-gray-500">Saving…</span>}
        {error && <span className="text-red-700">{error}</span>}
        {disabledMessage && <span className="text-gray-600">{disabledMessage}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {checked ? (
          <Link
            href={startHref}
            className="rounded-lg bg-[#163D6D] px-5 py-2.5 text-sm font-medium text-white"
          >
            Start the survey
          </Link>
        ) : (
          <span
            aria-disabled
            title="Confirm you have read the terms above to begin."
            className="cursor-not-allowed rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-medium text-gray-500"
          >
            Start the survey
          </span>
        )}
        <Link href="/benchmarking/worksheet" className="text-sm text-gray-600 underline">
          Print a blank copy to gather on paper first
        </Link>
      </div>
    </div>
  );
}
