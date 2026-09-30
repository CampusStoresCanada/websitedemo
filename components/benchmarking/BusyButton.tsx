"use client";

import { useRef, useState } from "react";

/**
 * A button that will not let you press it twice.
 *
 * Every action in this survey is a server round trip, and most of them insert a
 * row. On a slow connection the page looks inert for a second or two, so a
 * store clicks again, and again: the "add a category" chips would happily
 * create four copies of Apparel, and nothing downstream would know which one
 * was meant.
 *
 * ⛔ The guard is the ref, not the state. Two clicks in the same tick both read
 * the old state and both get through; a ref is set synchronously and the second
 * click sees it.
 */
export default function BusyButton({
  onClick,
  children,
  busyLabel,
  className = "",
  disabled = false,
  title,
  "aria-label": ariaLabel,
}: {
  onClick: () => void | Promise<unknown>;
  children: React.ReactNode;
  /** Shown while in flight. Defaults to the button's own label. */
  busyLabel?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onClick();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={disabled || busy}
      title={title}
      aria-label={ariaLabel}
      aria-busy={busy}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className="inline-flex items-center gap-1.5">
        {busy && <Spinner />}
        {busy && busyLabel ? busyLabel : children}
      </span>
    </button>
  );
}

/**
 * Deliberately small and monochrome.
 *
 * It sits inside buttons of every colour in this form, so it takes the text
 * colour rather than carrying one of its own.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
