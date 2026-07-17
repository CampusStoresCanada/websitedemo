"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/utils";

// Named layers straight from the source file (group "Mercury": Fill, Bulb,
// Fill_top_Line; group "Outline": the tube/dome/ticks). Path data extracted
// programmatically from the source file, not retyped, to guarantee
// byte-for-byte fidelity -- see the git history for the diff script used.
//
// Confirmed behavior: Bulb is always full (static reservoir). Fill (red)
// stretches -- its bottom edge stays fixed at the source file's own Fill
// bottom (566.62 + 159.35 = 725.97, inside the bulb), its top edge moves up
// as % grows. Fill_top_Line is a fixed-height (38.01) cap that always
// repositions to sit directly on top of Fill's current top edge -- it never
// stretches itself, only its y moves.
//
// The source file's own static position IS the 0% resting state, not an
// arbitrary example: Fill at its original height (159.35, top edge at
// 566.62) with the cap sitting right above it (y=528.62) is what "empty"
// looks like -- the mercury's natural resting level in the bulb/neck, not
// a fully-collapsed rect. Height only ever grows from there toward 100%,
// it never shrinks below it (that bug put the cap deep inside the bulb).
const FILL_X = 92.67;
const FILL_WIDTH = 93.27;
const FILL_BOTTOM_ANCHOR_Y = 725.97; // Fill's original bottom edge -- fixed always
const CAP_HEIGHT = 38.01; // Fill_top_Line's fixed height
const FILL_HEIGHT_AT_0_PCT = 159.35; // Fill's original height -- the resting state
const FILL_TOP_MAX_Y = 84.67; // tube meets the dome -- Fill_top_Line's top at 100%
const FILL_HEIGHT_AT_100_PCT = FILL_BOTTOM_ANCHOR_Y - CAP_HEIGHT - FILL_TOP_MAX_Y; // 603.29

const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);
const DURATION_MS = 1800;

export default function BursaryThermometer({
  raisedCents,
  goalCents,
}: {
  raisedCents: number;
  goalCents: number;
}) {
  const pct = goalCents > 0 ? Math.min(1, raisedCents / goalCents) : 0;
  const [revealed, setRevealed] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1, eased
  const [displayedCents, setDisplayedCents] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Reveal the moment this scrolls into view, not just on page load.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!revealed) return;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = EASE_OUT_CUBIC(t);
      setProgress(eased);
      setDisplayedCents(Math.round(raisedCents * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealed, raisedCents]);

  const fillHeight =
    FILL_HEIGHT_AT_0_PCT + progress * pct * (FILL_HEIGHT_AT_100_PCT - FILL_HEIGHT_AT_0_PCT);
  const fillY = FILL_BOTTOM_ANCHOR_Y - fillHeight;
  const capY = fillY - CAP_HEIGHT;

  return (
    <div ref={ref} className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="shrink-0 rounded-2xl bg-white p-4 shadow-lg">
        <svg viewBox="0 0 280 799.67" className="h-36 w-auto sm:h-44" aria-hidden="true">
          <g id="Mercury">
            <rect x={FILL_X} y={fillY} width={FILL_WIDTH} height={fillHeight} fill="#d6001c" />
            <path fill="#d6001c" d="M186,566.64l15.18,11.4c12.41,9.33,22.69,21.54,29.73,35.31,7.36,14.4,11.09,29.98,11.09,46.31,0,56.25-45.76,102-102,102s-102-45.75-102-102c0-31.89,14.53-61.37,39.85-80.87l14.82-12.17,93.33.02Z" />
            <rect x={FILL_X} y={capY} width={FILL_WIDTH} height={CAP_HEIGHT} />
          </g>
          <g id="Outline">
            <path d="M224,547.66V84.67C224,37.91,186.09,0,139.33,0h0C92.57,0,54.67,37.91,54.67,84.67v464.02C21.43,574.28,0,614.47,0,659.67c0,77.32,62.68,140,140,140s140-62.68,140-140c0-45.8-22-86.46-56-112.01ZM140,761.67c-56.24,0-102-45.76-102-102,0-31.9,14.53-61.37,39.85-80.88l14.82-12.17V84.67c0-25.73,20.93-46.67,46.67-46.67s46.27,20.56,46.65,45.96h-41.69c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v25.52h-41.71c-10.49,0-19,8.51-19,19s8.51,19,19,19h41.71v.02l15.18,11.4c12.41,9.33,22.7,21.54,29.73,35.31,7.36,14.4,11.09,29.98,11.09,46.31,0,56.24-45.76,102-102,102ZM217,660.9c-.12,1.9-1.45,19.07-10.83,36.65-13.41,25.12-36.91,38.96-66.17,38.96-10.49,0-19-8.51-19-19s8.51-19,19-19c15.07,0,25.3-5.72,32.18-17.99,5.96-10.64,6.9-22.03,6.91-22.14v.12s.08,0,.08,0c.85-9.68,8.96-17.27,18.86-17.27,10.46,0,18.95,8.48,18.95,18.95,0,.24-.03.48-.04.71h.07Z" />
          </g>
        </svg>
      </div>

      <div className="text-center sm:text-left">
        <p className="text-3xl font-bold tracking-tight text-white">{formatCents(displayedCents)}</p>
        <p className="mt-1 text-sm text-white/70">
          raised toward our <span className="font-semibold text-white">{formatCents(goalCents)}</span> goal
        </p>
        <p className="mt-2 max-w-xs text-xs text-white/50">
          $500 from every sponsorship goes toward covering delegate travel, stay, and participation in the conference.
        </p>
      </div>
    </div>
  );
}
