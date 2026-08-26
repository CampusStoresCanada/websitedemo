"use client";

import { useState } from "react";
import { setDisclosureLevel } from "@/lib/actions/benchmarking-survey";
import { DISCLOSURE_COPY, type DisclosureLevel } from "@/lib/benchmarking/disclosure";

/**
 * The store deciding whether it may be named to its peers.
 *
 * Framed as a choice between two legitimate options, not as an opt-out from a
 * default everyone is assumed to want. The reciprocity is stated in the option
 * itself rather than buried: a store that will not be named does not receive
 * named peers, and someone should learn that before choosing, not after the
 * report arrives looking thinner than they expected.
 *
 * Saves immediately. There is no submit button because there is no draft state
 * to be in — the value is live and changeable for as long as the cycle is open.
 */
export default function DisclosureChoice({
  benchmarkingId,
  initialLevel,
  sealedMessage,
}: {
  benchmarkingId: string;
  initialLevel: DisclosureLevel;
  /** Consent seal: Set once the successor survey has opened; the choice is then frozen. */
  sealedMessage?: string | null;
}) {
  const [level, setLevel] = useState<DisclosureLevel>(initialLevel);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: DisclosureLevel) {
    if (next === level || sealedMessage) return;
    const previous = level;
    setLevel(next);
    setSaving(true);
    setSaved(false);
    setError(null);

    const res = await setDisclosureLevel(benchmarkingId, next);
    setSaving(false);

    if (!res.success) {
      // Put it back. A control that shows the new state while having saved the
      // old one is worse than an error, because the store believes it chose.
      setLevel(previous);
      setError(res.error ?? "Could not save that choice.");
      return;
    }
    setSaved(true);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">
        How your store appears to other members
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Your figures count either way. This decides only whether your store is named.
      </p>

      {/*
        Shown instead of a dead control. The action refuses either way, but a
        radio that silently does nothing teaches a member the site is broken;
        the reason teaches them the year is closed and points at the one they
        can still change.
      */}
      {sealedMessage && (
        <p className="mt-3 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
          {sealedMessage}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {(Object.keys(DISCLOSURE_COPY) as DisclosureLevel[]).map((key) => {
          const copy = DISCLOSURE_COPY[key];
          const active = level === key;
          return (
            <label
              key={key}
              className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                active
                  ? "border-[#163D6D] bg-[#163D6D]/[0.04]"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="disclosure_level"
                className="mt-1"
                checked={active}
                disabled={saving || Boolean(sealedMessage)}
                onChange={() => choose(key)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{copy.label}</span>
                <span className="mt-1 block text-sm text-gray-600">{copy.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 min-h-[20px] text-sm" aria-live="polite">
        {saving && <span className="text-gray-500">Saving…</span>}
        {!saving && saved && <span className="text-green-700">Saved.</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        You can change this at any time while the survey is open. Once results have been
        sent out, changing it updates what members see on the site — it cannot recall a
        file that has already been delivered.
      </p>
    </section>
  );
}
