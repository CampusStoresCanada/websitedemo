"use client";

import { useEffect, useRef, useState } from "react";
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
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split("T")[0];
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
 * Lives on the row's actions kebab in the membership directory. Pausing stops
 * outbound renewal mail for this org until a date and does nothing else — the
 * membership, its expiry, its invoice and the grace/lock countdown all carry
 * on exactly as they would have. The dialog says so, because the whole risk
 * of a control like this is somebody reaching for it believing it buys the
 * member time.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [until, setUntil] = useState(() => addDays(todayInDispatchTz(), 30));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isPaused = !!pausedUntil;

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  function openDialog() {
    setMenuOpen(false);
    setUntil(pausedUntil ?? addDays(todayInDispatchTz(), 30));
    setReason(pauseReason ?? "");
    setError(null);
    setDialogOpen(true);
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
    setDialogOpen(false);
    router.refresh();
  }

  async function resume() {
    setMenuOpen(false);
    setBusy(true);
    const res = await clearRenewalNotificationPauseAction({ organizationId });
    setBusy(false);
    if (res.success) router.refresh();
  }

  return (
    <div className="relative shrink-0" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors disabled:opacity-40 ${
          isPaused
            ? "text-amber-600 hover:bg-amber-50"
            : "text-gray-400 hover:text-[#16345a] hover:bg-[#16345a]/10"
        }`}
        aria-label={`Actions for ${organizationName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <svg width="15" height="4" viewBox="0 0 16 4" fill="currentColor">
          <circle cx="1.85" cy="2" r="1.85" />
          <circle cx="8" cy="2" r="1.85" />
          <circle cx="14.15" cy="2" r="1.85" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-30 w-64 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={openDialog}
            className="block w-full px-3.5 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
          >
            {isPaused ? "Edit notification pause…" : "Pause renewal notifications…"}
          </button>
          {isPaused && (
            <button
              type="button"
              role="menuitem"
              onClick={resume}
              className="block w-full px-3.5 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
            >
              Resume notifications now
            </button>
          )}
        </div>
      )}

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !busy && setDialogOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[17px] font-semibold" style={{ color: INK }}>
              Pause renewal notifications
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
              Resume notifications after
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

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
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
                {busy ? "Saving…" : isPaused ? "Update pause" : "Pause notifications"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
