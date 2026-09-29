"use client";

import { useState } from "react";
import { confirmLogos } from "@/lib/actions/benchmarking-profile";

/**
 * Confirm the two logos the website uses.
 *
 * All 50 active member stores have a logo mark on file. Six have a horizontal
 * logo. So 44 stores are missing the asset banners and listings actually need,
 * and we have been falling back to the mark or to nothing.
 *
 * This is the one moment a year when every store is already confirming its
 * figures, its people and its locations. Asking here costs a glance for the
 * stores that are fine and gets us the other 44.
 *
 * ⛔ Confirming never blanks what we hold — see confirmLogos. A store saying
 * "yes that is still us" must not be able to delete its own logo by accident.
 */
export default function LogoConfirm({
  benchmarkingId,
  logoUrl,
  logoHorizontalUrl,
  confirmedAt,
  isReadOnly,
}: {
  benchmarkingId: string;
  logoUrl: string | null;
  logoHorizontalUrl: string | null;
  confirmedAt: string | null;
  isReadOnly: boolean;
}) {
  const [markUrl, setMarkUrl] = useState(logoUrl ?? "");
  const [horizontalUrl, setHorizontalUrl] = useState(logoHorizontalUrl ?? "");
  const [confirmed, setConfirmed] = useState(Boolean(confirmedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await confirmLogos({
      benchmarkingId,
      logoUrl: markUrl.trim() || undefined,
      logoHorizontalUrl: horizontalUrl.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    setConfirmed(true);
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-medium text-gray-900">Your logos</h3>
      <p className="mt-1 text-xs text-gray-600">
        These are what we put beside your store on the CSC site. Worth ten seconds while
        you are here — most stores have never given us the horizontal one.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          {
            label: "Logo mark",
            where: "Used in listings, small spaces and the member directory.",
            value: markUrl,
            set: setMarkUrl,
          },
          {
            label: "Horizontal logo",
            where: "Used on banners and anywhere wide. This is the one we are usually missing.",
            value: horizontalUrl,
            set: setHorizontalUrl,
          },
        ].map((f) => (
          <div key={f.label}>
            <label className="block text-xs font-medium text-gray-700">{f.label}</label>
            <p className="text-[11px] leading-snug text-gray-500">{f.where}</p>
            <div className="mt-2 flex h-20 items-center justify-center rounded border border-dashed border-gray-300 bg-white p-2">
              {f.value ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.value}
                  alt={`${f.label} preview`}
                  className="max-h-16 max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-gray-400">Nothing on file</span>
              )}
            </div>
            <input
              type="url"
              value={f.value}
              disabled={isReadOnly}
              placeholder="https://…"
              onChange={(e) => f.set(e.target.value)}
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
            />
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : confirmed ? "Update" : "These are right"}
          </button>
          {confirmed && <span className="text-xs text-green-700">Confirmed.</span>}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
