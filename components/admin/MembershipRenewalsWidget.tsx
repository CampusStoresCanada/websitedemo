"use client";

import { useEffect, useRef, useState } from "react";
import type { RenewalOrgType, RenewalProgressData, RenewalTypeProgress } from "@/lib/renewal/renewal-progress";

// ─────────────────────────────────────────────────────────────────
// Design tokens — ported 1:1 from the approved SVG concept (exact
// gradient stops, ink, and track color) rather than the site's generic
// Tailwind red/blue convention. Font is Gotham (var(--font-primary)),
// already loaded site-wide via Typekit in app/layout.tsx.
// ─────────────────────────────────────────────────────────────────

const CARD_BG = "#e5e5e5";
const TRACK = "#cccccc";
const INK = "#16345a";
const FONT = "var(--font-primary)";
const BASE_CAPSULE_HEIGHT = 146;

const TYPE_STYLE: Record<
  RenewalOrgType,
  { colorA: string; colorB: string; label: string; side: "left" | "right" }
> = {
  Member: { colorA: "#e72a28", colorB: "#9e1b43", label: "Members", side: "left" },
  "Vendor Partner": { colorA: "#16345a", colorB: "#0000ff", label: "Partners", side: "right" },
};

type ViewMode = "both" | "bars" | "lines";

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ─────────────────────────────────────────────────────────────────
// Smooth line — Catmull-Rom-to-cubic-Bezier fit through daily points.
// No charting library in this repo; this is the standard lightweight
// approach for a hand-rolled smooth SVG path.
// ─────────────────────────────────────────────────────────────────

function splinePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function buildLinePath(counts: number[], maxCount: number): string {
  if (counts.length < 2) return "";
  const bandTop = 38;
  const bandBottom = 62;
  const points = counts.map((count, i) => ({
    x: (i / (counts.length - 1)) * 100,
    y: bandBottom - (count / maxCount) * (bandBottom - bandTop),
  }));
  return splinePath(points);
}

// ─────────────────────────────────────────────────────────────────
// Three-dot view menu
// ─────────────────────────────────────────────────────────────────

function ViewMenu({ viewMode, onChange }: { viewMode: ViewMode; onChange: (m: ViewMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const options: { mode: ViewMode; label: string }[] = [
    { mode: "both", label: "Bars & lines" },
    { mode: "bars", label: "Bars only" },
    { mode: "lines", label: "Lines only" },
  ];

  return (
    <div
      ref={ref}
      className="absolute"
      style={{ top: 24, right: 22 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Widget view options"
        className="flex items-center justify-center rounded-md transition-colors"
        style={{ width: 22, height: 22, color: INK }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(22,52,90,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor">
          <circle cx="1.85" cy="2" r="1.85" />
          <circle cx="8" cy="2" r="1.85" />
          <circle cx="14.15" cy="2" r="1.85" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-10 rounded-lg bg-white shadow-lg"
          style={{ top: 26, right: 0, minWidth: 108, border: "1px solid #d8d8d8", padding: 3 }}
        >
          {options.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onChange(mode);
                setOpen(false);
              }}
              className="block w-full rounded text-left"
              style={{
                fontSize: 11,
                padding: "5px 7px",
                color: viewMode === mode ? INK : "#555",
                fontWeight: viewMode === mode ? 600 : 400,
                background: viewMode === mode ? "#f2f2f2" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Pill (capsule progress meter)
// ─────────────────────────────────────────────────────────────────

function Pill({
  progress,
  heightPx,
  active,
  faded,
  onFocus,
  showBar,
}: {
  progress: RenewalTypeProgress;
  heightPx: number;
  active: boolean;
  faded: boolean;
  onFocus: () => void;
  showBar: boolean;
}) {
  const style = TYPE_STYLE[progress.orgType];
  const pct = progress.totalExpectedCents > 0
    ? Math.min(100, (progress.collectedCents / progress.totalExpectedCents) * 100)
    : 0;

  const labelSideStyle =
    style.side === "left"
      ? { right: "100%" as const, marginRight: 9 }
      : { left: "100%" as const, marginLeft: 10 };

  return (
    <div
      className="flex flex-col items-center transition-opacity duration-300"
      style={{ opacity: faded ? 0.32 : 1 }}
    >
      <div className="relative" style={{ width: 14, height: heightPx }}>
        <div className="absolute inset-0" style={{ background: TRACK, borderRadius: 7 }} />

        <div
          className="absolute left-0 right-0 bottom-0 transition-all duration-500"
          style={{
            height: `${pct}%`,
            borderRadius: progress.isComplete ? 7 : "0 0 7px 7px",
            background: `linear-gradient(180deg, ${style.colorA} 0%, ${style.colorB} 100%)`,
            transform: active ? "scaleX(1.15)" : "scaleX(1)",
            transition: "height 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.2s ease",
          }}
        >
          {progress.isComplete && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 13.2 12.6"
              className="absolute"
              style={{ top: 5, left: "50%", transform: "translateX(-50%)" }}
            >
              <path
                fill="#fff"
                d="M6.24.34l1.42,3.26,3.54.34c.37.04.53.5.24.75l-2.66,2.35.77,3.47c.08.37-.31.65-.64.46l-3.06-1.8-3.06,1.8c-.32.19-.72-.1-.64-.46l.77-3.47L.26,4.69C-.03,4.44.13,3.98.5,3.94l3.54-.34L5.45.34c.15-.34.64-.34.79,0Z"
              />
            </svg>
          )}
        </div>

        <span
          className="absolute whitespace-nowrap pointer-events-none transition-opacity duration-200"
          style={{
            ...labelSideStyle,
            top: -3,
            fontFamily: FONT,
            fontWeight: 500,
            fontSize: 9.5,
            color: style.colorA,
            transform: "rotate(-22.5deg)",
            transformOrigin: "left bottom",
            opacity: active ? 1 : 0,
          }}
        >
          {formatDollars(progress.totalExpectedCents)}
        </span>

        {!progress.isComplete && (
          <span
            className="absolute whitespace-nowrap pointer-events-none transition-opacity duration-200"
            style={{
              ...labelSideStyle,
              bottom: `${pct}%`,
              fontFamily: FONT,
              fontWeight: 500,
              fontSize: 9.5,
              color: style.colorA,
              transform: "rotate(-22.5deg)",
              transformOrigin: "left bottom",
              opacity: active ? 1 : 0,
            }}
          >
            {formatDollars(progress.collectedCents)}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          aria-label={`${style.label} — ${progress.renewedCount} of ${progress.populationCount} renewed`}
          className="absolute inset-0 cursor-pointer"
          style={{ zIndex: 3, background: "transparent", border: "none", padding: 0, opacity: showBar ? 1 : 0.2 }}
        />
      </div>

      <div className="text-center" style={{ marginTop: 8 }}>
        <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 11, color: INK }}>{style.label}</div>
        <div
          className="transition-opacity duration-200"
          style={{ fontSize: 9.5, color: "#7a7a7a", marginTop: 1, opacity: active ? 1 : 0 }}
        >
          {progress.renewedCount} of {progress.populationCount} renewed
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Widget
// ─────────────────────────────────────────────────────────────────

export function MembershipRenewalsWidget({ data }: { data: RenewalProgressData }) {
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [focusedType, setFocusedType] = useState<RenewalOrgType | null>(null);

  const member = data.types.Member;
  const partner = data.types["Vendor Partner"];

  const maxCount = Math.max(
    1,
    ...member.dailyRenewalCounts.map((d) => d.count),
    ...partner.dailyRenewalCounts.map((d) => d.count)
  );

  const maxTotalCents = Math.max(member.totalExpectedCents, partner.totalExpectedCents, 1);
  const memberHeight = Math.max(20, BASE_CAPSULE_HEIGHT * (member.totalExpectedCents / maxTotalCents));
  const partnerHeight = Math.max(20, BASE_CAPSULE_HEIGHT * (partner.totalExpectedCents / maxTotalCents));

  const showBars = viewMode !== "lines";
  const showLines = viewMode !== "bars";

  return (
    <div
      className="relative mb-8"
      style={{ width: 330, height: 300, background: CARD_BG, borderRadius: 8, padding: "22px 24px", overflow: "hidden" }}
      onClick={() => setFocusedType(null)}
    >
      <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: INK, margin: 0 }}>
        Membership Renewals
      </p>
      <ViewMenu viewMode={viewMode} onChange={setViewMode} />

      <div className="relative" style={{ height: 220, marginTop: 16 }}>
        {showLines && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path
              d={buildLinePath(partner.dailyRenewalCounts.map((d) => d.count), maxCount)}
              fill="none"
              stroke={TYPE_STYLE["Vendor Partner"].colorA}
              strokeWidth={focusedType === "Vendor Partner" ? 2 : 1.4}
              opacity={focusedType === "Vendor Partner" ? 0.9 : focusedType === "Member" ? 0.15 : 0.45}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={buildLinePath(member.dailyRenewalCounts.map((d) => d.count), maxCount)}
              fill="none"
              stroke={TYPE_STYLE.Member.colorA}
              strokeWidth={focusedType === "Member" ? 2 : 1.4}
              opacity={focusedType === "Member" ? 0.9 : focusedType === "Vendor Partner" ? 0.15 : 0.45}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        <div className="relative flex items-end justify-center" style={{ height: "100%", gap: 56 }}>
          <Pill
            progress={member}
            heightPx={memberHeight}
            active={focusedType === "Member"}
            faded={focusedType === "Vendor Partner"}
            onFocus={() => setFocusedType("Member")}
            showBar={showBars}
          />
          <Pill
            progress={partner}
            heightPx={partnerHeight}
            active={focusedType === "Vendor Partner"}
            faded={focusedType === "Member"}
            onFocus={() => setFocusedType("Vendor Partner")}
            showBar={showBars}
          />
        </div>
      </div>
    </div>
  );
}
