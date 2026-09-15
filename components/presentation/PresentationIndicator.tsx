"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePresentationMode } from "@/lib/actions/presentation-mode";
import {
  PRESENTATION_LABELS,
  PRESENTATION_LEVELS,
  type PresentationLevel,
} from "@/lib/presentation/mode";

/**
 * The always-visible proof that presentation mode is on.
 *
 * The failure mode of a mode like this is never that it doesn't work — it is
 * presenting while convinced it is on when it is off, which is how a screen
 * share leaks something. So this is deliberately hard to miss and hard to
 * dismiss: a frame around the whole viewport plus a persistent bar. There is
 * no "hide this" affordance, because a hidden indicator is the bug.
 *
 * Rendered only when the mode is actually on, from the server layout, so its
 * presence on screen IS the state — it cannot disagree with what the pages
 * beneath it are masking.
 */
export default function PresentationIndicator({
  level,
}: {
  level: PresentationLevel;
}) {
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  function change(next: PresentationLevel | null) {
    setMenuOpen(false);
    startTransition(async () => {
      await updatePresentationMode(next);
      router.refresh();
    });
  }

  return (
    <>
      {/* Frame. pointer-events-none so it never swallows a click mid-demo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[9998] border-4 border-amber-500"
      />

      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-lg"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-950"
          />
          Presentation mode — you are seeing this site as{" "}
          <strong>{PRESENTATION_LABELS[level]}</strong>
        </span>

        <span className="hidden text-amber-900 sm:inline">
          Staff-only data is withheld. Your edit permissions are unchanged.
        </span>

        <span className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={pending}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            className="rounded border border-amber-900/40 bg-amber-400 px-2 py-1 text-xs hover:bg-amber-300 disabled:opacity-60"
          >
            Switch audience
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute bottom-full right-0 mb-2 min-w-44 overflow-hidden rounded border border-amber-900/30 bg-white shadow-xl"
            >
              {PRESENTATION_LEVELS.map((l) => (
                <button
                  key={l}
                  role="menuitem"
                  type="button"
                  onClick={() => change(l)}
                  className={`block w-full px-3 py-2 text-left text-xs hover:bg-amber-50 ${
                    l === level ? "font-semibold text-amber-800" : "text-gray-700"
                  }`}
                >
                  {PRESENTATION_LABELS[l]}
                  {l === level ? " ✓" : ""}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => change(null)}
            disabled={pending}
            className="rounded bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
          >
            {pending ? "Turning off…" : "Turn off"}
          </button>
        </span>
      </div>

      {/* The bar is fixed, so give the page floor somewhere to end. */}
      <div aria-hidden="true" className="h-12" />
    </>
  );
}
