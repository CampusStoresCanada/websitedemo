"use client";

import { useEffect, useState, type ReactNode } from "react";

const OPTIONS = [
  { key: "attendee" as const, title: "Delegate", blurb: "Send your team to buy, meet, and learn." },
  { key: "vendor" as const, title: "Exhibitor", blurb: "Show your products to campus stores across Canada." },
];

const STORAGE_KEY = "csc-conference-persona";

/**
 * Shown to anyone without a recognized Member/Partner org — anonymous
 * visitors and signed-in accounts whose org doesn't qualify alike. Interrupts
 * the page with a full-screen Delegate/Exhibitor choice instead of a switcher
 * buried in the page — both panels are already rendered server-side, so
 * picking one just fades the overlay out and reveals it in place, no
 * re-fetch or scrolling required. Remembered for the browser tab's session so
 * repeat visits don't re-ask.
 */
export default function PersonaTabs({ attendee, vendor }: { attendee: ReactNode; vendor: ReactNode }) {
  const [tab, setTab] = useState<"attendee" | "vendor" | null>(null);
  const [showChooser, setShowChooser] = useState(false);
  const [closing, setClosing] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === "attendee" || stored === "vendor") {
      setTab(stored);
      setRevealed(true);
    } else {
      setShowChooser(true);
    }
  }, []);

  useEffect(() => {
    if (!showChooser) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChooser]);

  const dismiss = () => {
    setClosing(true);
    setTimeout(() => {
      setShowChooser(false);
      setClosing(false);
    }, 200);
  };

  const choose = (next: "attendee" | "vendor") => {
    sessionStorage.setItem(STORAGE_KEY, next);
    setTab(next);
    setClosing(true);
    setTimeout(() => {
      setShowChooser(false);
      setClosing(false);
      setRevealed(true);
    }, 200);
  };

  return (
    <div>
      {showChooser && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-white/95 p-6 backdrop-blur-sm transition-opacity duration-200 ${
            closing ? "opacity-0" : "opacity-100"
          }`}
          onClick={dismiss}
        >
          <button
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-6 top-6 text-2xl leading-none text-[#6B6B6B] hover:text-[#1A1A1A]"
          >
            ×
          </button>
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-semibold uppercase tracking-wide text-[#6B6B6B]">
              Would you like to attend as a
            </p>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row">
              {OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => choose(option.key)}
                  className="flex-1 rounded-2xl border-2 border-[#E5E5E5] bg-white p-8 text-left transition-all hover:border-[#EE2A2E] hover:shadow-lg"
                >
                  <span className="text-2xl font-bold text-[#1A1A1A]">{option.title}</span>
                  <p className="mt-2 text-sm text-[#6B6B6B]">{option.blurb}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab && (
        <div className={`transition-opacity duration-300 ${revealed ? "opacity-100" : "opacity-0"}`}>
          {tab === "attendee" ? attendee : vendor}
        </div>
      )}
    </div>
  );
}
