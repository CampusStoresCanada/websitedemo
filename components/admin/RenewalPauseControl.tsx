"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setRenewalNotificationPauseAction,
  clearRenewalNotificationPauseAction,
} from "@/lib/actions/renewal-pause";

const INK = "#16345a";

/** Today in the renewal dispatch timezone, as YYYY-MM-DD. */
function todayInDispatchTz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split("T")[0];
}

export function formatPauseDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Per-org control for pausing membership renewal notifications.
 *
 * Sits inline on the directory row, next to the view-organization link, as a
 * single icon that opens the dialog directly. It is deliberately not tucked
 * behind an overflow menu: the whole point of the tool is that somebody
 * reaches for it in the moment a member says "we already paid", and a control
 * nobody can find is the same as not having one.
 *
 * Pausing stops outbound renewal mail for this org until a date and does
 * nothing else — the membership, its expiry, its invoice and the grace/lock
 * countdown all carry on exactly as they would have. The dialog says so,
 * because the real risk of a control like this is somebody reaching for it
 * believing it buys the member time.
 */
export function RenewalPauseControl({
  organizationId,
  organizationName,
  pausedUntil,
  pauseReason,
}: {
  organizationId: string;
  organizationName: string;
  pausedUntil: string | null;
  pauseReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(() => addDays(todayInDispatchTz(), 30));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaused = !!pausedUntil;

  function openDialog(e: React.MouseEvent) {
    e.stopPropagation();
    setUntil(pausedUntil ?? addDays(todayInDispatchTz(), 30));
    setReason(pauseReason ?? "");
    setError(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setRenewalNotificationPauseAction({
      organizationId,
      pausedUntil: until,
      reason,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "Could not save the pause.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function resume() {
    setBusy(true);
    setError(null);
    const res = await clearRenewalNotificationPauseAction({ organizationId });
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "Could not resume notifications.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const label = isPaused
    ? `Reminders paused until ${formatPauseDate(pausedUntil)} — edit`
    : "Pause renewal reminders";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={busy}
        className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-colors disabled:opacity-40 ${
          isPaused
            ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
            : "text-gray-400 hover:text-[#16345a] hover:bg-[#16345a]/10"
        }`}
        title={label}
        aria-label={`${label} for ${organizationName}`}
      >
        {isPaused ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M10 9v6M14 9v6" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[17px] font-semibold" style={{ color: INK }}>
              {isPaused ? "Renewal reminders paused" : "Pause renewal reminders"}
            </h2>
            <p className="mt-1 text-[13px] text-gray-500">{organizationName}</p>

            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
              This stops renewal emails only. Their membership, expiry date and
              invoice balance don&apos;t change, and the grace period keeps
              counting down — if it runs out while paused, they&apos;ll be
              locked out and CSC gets an ops alert instead of the member getting
              an email.
            </p>

            <label className="mt-4 block text-[12.5px] font-medium text-gray-700">
              Resume reminders after
              <input
                type="date"
                value={until}
                min={todayInDispatchTz()}
                onChange={(e) => setUntil(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] text-gray-900"
              />
            </label>
            <p className="mt-1 text-[11.5px] text-gray-400">
              Pauses need an end date so a quiet org doesn&apos;t stay quiet
              forever. Extend it later if the payment still hasn&apos;t landed.
            </p>

            <label className="mt-4 block text-[12.5px] font-medium text-gray-700">
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Paid by EFT — funds in transit, confirmed with the bookstore."
                className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] text-gray-900"
              />
            </label>

            {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

            <div className="mt-5 flex items-center justify-between gap-2">
              {/* Resuming is the one action that needs to be reachable without
                  re-justifying anything — the payment landed, stop being quiet. */}
              {isPaused ? (
                <button
                  type="button"
                  onClick={resume}
                  disabled={busy}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  Resume now
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !reason.trim()}
                  className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  style={{ background: INK }}
                >
                  {busy ? "Saving…" : isPaused ? "Update pause" : "Pause reminders"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
