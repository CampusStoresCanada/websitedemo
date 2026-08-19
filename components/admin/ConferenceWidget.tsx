"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConferenceDashboardStats,
  ConferenceStatKey,
} from "@/lib/conference/dashboard-stats";
import { splinePath } from "@/lib/utils/spline";

// ─────────────────────────────────────────────────────────────────
// Geometry and tokens ported 1:1 from the approved SVG concept —
// card box, gradient stops, baselines and the dashed rules are the
// designer's coordinates, not re-derived. Font is Gotham
// (var(--font-primary)), loaded site-wide via Typekit.
// ─────────────────────────────────────────────────────────────────

const CARD_W = 372.29;
const CARD_H = 309.98;
const CARD_R = 34.99;

const FONT = "var(--font-primary)";
const INK = "#ffffff";
const FAINT = "#f2f2f2";

/** Chart band the lines are drawn inside. */
const BAND = { x0: 38, x1: 348, yTop: 132, yBottom: 194 };

/** Baselines lifted straight off the SVG. */
const STAT_COLUMNS: { key: ConferenceStatKey; x: number }[] = [
  { key: "delegates", x: 38.65 },
  { key: "booths", x: 155.67 },
  { key: "members", x: 271.88 },
];

const DIVIDER_X = [131.78, 238.5];

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

function formatValue(key: ConferenceStatKey, value: number): string {
  return key === "revenue" ? currency.format(value / 100) : String(value);
}

/** Nudge the headline down a step once the string outgrows the card. */
function headlineSize(text: string): number {
  if (text.length <= 9) return 43;
  if (text.length <= 11) return 36;
  return 30;
}

function formatDay(date: string): string {
  // Date-only string — split rather than parse, so it can't shift a day in
  // whichever timezone the browser happens to be in.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * Each series is scaled against its own peak — the four lines share a band but
 * not a unit (cents vs. counts), so a shared scale would flatten every count
 * line to nothing against revenue.
 */
function seriesPath(values: number[]): string {
  if (values.length < 2) return "";

  // A series with nothing in it yet (no delegates registered, no members
  // signed up) would otherwise render as a dead flat rule along the bottom of
  // the band, which reads as an axis rather than as "no data". Draw nothing.
  const peak = Math.max(...values, 0);
  if (peak <= 0) return "";

  const span = BAND.yBottom - BAND.yTop;
  const points = values.map((value, i) => ({
    x: BAND.x0 + (i / (values.length - 1)) * (BAND.x1 - BAND.x0),
    y: BAND.yBottom - (value / peak) * span,
  }));
  return splinePath(points);
}

// ─────────────────────────────────────────────────────────────────
// Three-dot menu
// ─────────────────────────────────────────────────────────────────

function DotsMenu({ conferenceId }: { conferenceId: string }) {
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

  const links = [
    { href: `/admin/conference/${conferenceId}/overview`, label: "Overview" },
    { href: `/admin/conference/${conferenceId}/registrations`, label: "Registrations" },
    { href: `/admin/conference/${conferenceId}/floor-plan`, label: "Floor plan" },
  ];

  return (
    <div
      ref={ref}
      className="absolute"
      style={{ top: "13.5%", right: "6.5%" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Conference widget options"
        aria-expanded={open}
        className="flex items-center justify-center rounded-md transition-colors"
        style={{ width: 26, height: 20, color: INK }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <svg width="19" height="5" viewBox="0 0 19 5" fill="currentColor">
          <circle cx="2.16" cy="2.5" r="2.16" />
          <circle cx="9.5" cy="2.5" r="2.16" />
          <circle cx="16.84" cy="2.5" r="2.16" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-10 rounded-lg bg-white shadow-lg"
          style={{ top: 24, right: 0, minWidth: 132, border: "1px solid #d8d8d8", padding: 3 }}
        >
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Widget
// ─────────────────────────────────────────────────────────────────

export function ConferenceWidget({ data }: { data: ConferenceDashboardStats }) {
  const [focused, setFocused] = useState<ConferenceStatKey>("revenue");
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const focusedSeries = data.series[focused];
  const dayCount = focusedSeries.daily.length;

  const paths = useMemo(
    () =>
      (Object.keys(data.series) as ConferenceStatKey[]).map((key) => ({
        key,
        d: seriesPath(data.series[key].daily.map((point) => point.value)),
      })),
    [data.series]
  );

  const focusedPath = paths.find((p) => p.key === focused)?.d ?? "";

  // Scrub shows that day's volume; letting go returns to the running total.
  const scrubbedDay = scrubIndex !== null ? focusedSeries.daily[scrubIndex] : null;
  const headlineNumber = scrubbedDay ? scrubbedDay.value : focusedSeries.total;
  const headline = formatValue(focused, headlineNumber);
  const caption = scrubbedDay
    ? `${focusedSeries.label} · ${formatDay(scrubbedDay.date)}`
    : "The Conference";

  function onScrub(e: React.PointerEvent<SVGRectElement>) {
    if (dayCount < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const index = Math.round(Math.min(1, Math.max(0, frac)) * (dayCount - 1));
    setScrubIndex(index);
  }

  return (
    <div
      className="relative"
      style={{ width: CARD_W, maxWidth: "100%", aspectRatio: `${CARD_W} / ${CARD_H}` }}
    >
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`${data.conferenceName}: ${currency.format(
          data.series.revenue.total / 100
        )} revenue, ${data.series.delegates.total} delegates, ${data.series.booths.total} booths, ${
          data.series.members.total
        } member organizations`}
      >
        <defs>
          <linearGradient id="csc-conf-widget-bg" x1="0" y1="154.99" x2={CARD_W} y2="154.99" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="red" />
            <stop offset="1" stopColor="#9e1b43" />
          </linearGradient>
          <clipPath id="csc-conf-widget-clip">
            <rect width={CARD_W} height={CARD_H} rx={CARD_R} ry={CARD_R} />
          </clipPath>
        </defs>

        <rect width={CARD_W} height={CARD_H} rx={CARD_R} ry={CARD_R} fill="url(#csc-conf-widget-bg)" />

        {/* Eyebrow — doubles as the scrubbed-day readout */}
        <text x="39.2" y="54.27" fill={INK} style={{ fontFamily: FONT, fontSize: 18, fontWeight: 400 }}>
          {caption}
        </text>

        {/* Headline */}
        <text
          x="39.2"
          y="111.55"
          fill={INK}
          style={{ fontFamily: FONT, fontSize: headlineSize(headline), fontWeight: 700 }}
        >
          {headline}
        </text>

        {/* Lines — unfocused series sit behind as the designer's faint traces */}
        <g clipPath="url(#csc-conf-widget-clip)">
          {paths
            .filter((p) => p.key !== focused && p.d !== "")
            .map((p) => (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={FAINT}
                strokeWidth={0.5}
                opacity={0.75}
                strokeMiterlimit={10}
              />
            ))}
          {focusedPath !== "" && (
            <path
              d={focusedPath}
              fill="none"
              stroke={INK}
              strokeWidth={6}
              strokeLinecap="round"
              strokeMiterlimit={10}
              style={{ transition: "d 0.35s ease" }}
            />
          )}
          {scrubbedDay && dayCount > 1 && focusedPath !== "" && (
            <line
              x1={BAND.x0 + ((scrubIndex ?? 0) / (dayCount - 1)) * (BAND.x1 - BAND.x0)}
              x2={BAND.x0 + ((scrubIndex ?? 0) / (dayCount - 1)) * (BAND.x1 - BAND.x0)}
              y1={BAND.yTop - 8}
              y2={BAND.yBottom + 8}
              stroke={INK}
              strokeWidth={1}
              opacity={0.55}
            />
          )}
        </g>

        {/* Scrub target */}
        <rect
          x={BAND.x0}
          y={BAND.yTop - 14}
          width={BAND.x1 - BAND.x0}
          height={BAND.yBottom - BAND.yTop + 28}
          fill="transparent"
          style={{ cursor: dayCount > 1 ? "col-resize" : "default" }}
          onPointerMove={onScrub}
          onPointerLeave={() => setScrubIndex(null)}
        />

        {/* Dashed column rules */}
        {DIVIDER_X.map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1="217.72"
            y2="274.93"
            stroke={INK}
            strokeDasharray="3"
            strokeMiterlimit={10}
          />
        ))}

        {/* Stats — clicking one makes it the bold line and the headline */}
        {STAT_COLUMNS.map(({ key, x }) => {
          const series = data.series[key];
          const isFocused = focused === key;
          return (
            <g
              key={key}
              onClick={() => {
                setFocused(isFocused ? "revenue" : key);
                setScrubIndex(null);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect x={x - 8} y="212" width="94" height="66" fill="transparent" />
              <text
                x={x}
                y="231.24"
                fill={INK}
                opacity={isFocused ? 1 : 0.82}
                style={{ fontFamily: FONT, fontSize: 14, fontWeight: 400 }}
              >
                {series.label}
              </text>
              <text
                x={x}
                y="267.26"
                fill={isFocused ? INK : FAINT}
                opacity={isFocused ? 1 : 0.85}
                style={{ fontFamily: FONT, fontSize: 22, fontWeight: 500 }}
              >
                {series.total}
              </text>
              {isFocused && (
                <rect x={x} y="273" width="26" height="2" rx="1" fill={INK} />
              )}
            </g>
          );
        })}
      </svg>

      <DotsMenu conferenceId={data.conferenceId} />
    </div>
  );
}
