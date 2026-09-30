"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "csc_survey_flag_callout_dismissed";

/**
 * "Don't guess. Flag it."
 *
 * Built on the same shape as ToolkitCallout, which points at the same button
 * from the org page. ⛔ A different STORAGE_KEY on purpose: somebody who
 * dismissed the org-page hint months ago has not been told this, and the two
 * say different things. Sharing the key would silently skip it for exactly the
 * members who have used the site longest.
 *
 * The thing it is fighting is the single most expensive behaviour in the whole
 * survey: a store that does not understand a question puts a number in anyway,
 * and nobody ever finds out. Every guess is a question we have written badly,
 * and we only learn which ones if asking is easier than guessing.
 */
export default function SurveyFlagCallout() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return; // localStorage unavailable: skip rather than nag every load
    }
    // Let the survey settle before anything pops over it.
    const t = setTimeout(() => setVisible(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Opening the toolkit means they have understood. Get out of the way.
  useEffect(() => {
    if (!visible) return;
    function onInteract(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-toolkit-fab]") || target.closest("[data-toolkit]")) {
        dismiss();
      }
    }
    document.addEventListener("click", onInteract, { capture: true });
    return () => document.removeEventListener("click", onInteract, { capture: true });
  }, [visible]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // silent
    }
  }

  if (!visible) return null;

  return (
    <>
      {/*
        A ring around the toolkit button rather than a dimmed overlay. The
        survey is a form people are part-way through; dimming it to teach them
        something is a modal in disguise, and it arrives when they are trying to
        do something else.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-6 right-6 z-30 h-16 w-16 animate-pulse rounded-full ring-4 ring-[#EE2A2E]/60"
      />

      <div
        className="fixed bottom-28 right-6 z-40 max-w-[280px] rounded-xl bg-[#1A1A1A] px-4 py-3 text-white shadow-xl"
        role="dialog"
        aria-label="How to ask about a question"
      >
        <button
          onClick={dismiss}
          className="absolute right-2 top-2 text-white/40 transition-colors hover:text-white/80"
          aria-label="Dismiss"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {step === 1 ? (
          <>
            <p className="pr-5 text-sm font-semibold leading-snug">
              If you do not understand a question, do not guess.
            </p>
            <p className="mt-1.5 text-xs leading-snug text-white/75">
              We are right here with you. Flag the thing you do not understand and the
              committee gets a message straight away.
            </p>
            <button
              onClick={() => setStep(2)}
              className="mt-3 text-xs font-medium text-white underline underline-offset-4"
            >
              Show me how
            </button>
          </>
        ) : (
          <>
            <p className="pr-5 text-sm font-semibold leading-snug">Three steps</p>
            <ol className="mt-1.5 space-y-1 text-xs leading-snug text-white/75">
              <li>1. Open the toolkit, bottom right.</li>
              <li>2. Choose Flag.</li>
              <li>3. Click the question, and tell us what is unclear.</li>
            </ol>
            <p className="mt-2 text-xs leading-snug text-white/75">
              Nothing you flag changes your answers, and you can carry on filling the rest
              in while you wait.
            </p>
            <button
              onClick={dismiss}
              className="mt-3 text-xs font-medium text-white underline underline-offset-4"
            >
              Got it
            </button>
          </>
        )}

        <div className="absolute -bottom-2 right-8 h-2 w-4 overflow-hidden">
          <div className="ml-0.5 h-3 w-3 translate-y-[-50%] rotate-45 bg-[#1A1A1A]" />
        </div>
      </div>
    </>
  );
}
