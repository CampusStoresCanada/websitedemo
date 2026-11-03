"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export type ConfirmActionResult = { success: boolean; error?: string } | void;

/**
 * Every button that does something, asked twice (Stephen, 2026-10-23: "all
 * buttons get confirmation").
 *
 * The rule is ConfirmSendButton's, learned when the call for nominations went
 * to 39 member administrators from one unguarded press: the first press only
 * ARMS it, and the confirmation names the blast radius. A generic "are you
 * sure?" stops nobody — the person pressing already believes they know what it
 * does. "This emails 39 institutions" stops them, because the number is the
 * thing that surprises. So `consequence` is required, and should carry a count.
 *
 * ⚠️ components/admin/elections/ConfirmSendButton and ConfirmSubmitButton are
 * the same idea for email only. They move onto this after 20 Nov: the
 * benchmarking admin page imports ConfirmSendButton, and benchmarking is frozen
 * for the FY2026 cycle (CLAUDE.md).
 */
export default function ConfirmAction({
  label,
  consequence,
  confirmLabel,
  onConfirm,
  tone = "primary",
  size = "sm",
  disabled = false,
}: {
  /** What the button says before it is armed. */
  label: string;
  /** What will happen, with the count: "Prints 34 badges.", "Emails 120 people." */
  consequence: string;
  /** The armed button. Defaults to "Yes, " + label. */
  confirmLabel?: string;
  onConfirm: () => Promise<ConfirmActionResult>;
  /** `danger` for anything destructive or irreversible. */
  tone?: "primary" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-start">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className={`rounded-md font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${
            tone === "danger"
              ? "border border-red-300 bg-white text-red-700 hover:bg-red-50"
              : "bg-[#163D6D] text-white hover:bg-[#12325a]"
          }`}
        >
          {label}
        </button>
        {error ? <span className="mt-1 text-xs text-red-600">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col rounded-lg border border-amber-300 bg-amber-50 p-2.5">
      <span className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        <span>{consequence}</span>
      </span>
      <span className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await onConfirm();
            setBusy(false);
            setArmed(false);
            if (result && !result.success) setError(result.error ?? "That didn't work.");
          }}
          className={`rounded-md font-semibold text-white disabled:opacity-50 ${pad} ${
            tone === "danger" ? "bg-[#B92026] hover:bg-[#9c1b20]" : "bg-[#163D6D] hover:bg-[#12325a]"
          }`}
        >
          {busy ? "Working…" : confirmLabel ?? `Yes, ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        </button>
        {/* Focus lands on Cancel: a row that shows its buttons on hover stays
            open while the question is up (focus-within), and a stray Enter
            backs out rather than confirming. */}
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={() => setArmed(false)}
          className={`rounded-md border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 ${pad}`}
        >
          Cancel
        </button>
      </span>
    </span>
  );
}
