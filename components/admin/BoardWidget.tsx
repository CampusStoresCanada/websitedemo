"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BoardDashboardStats } from "@/lib/board/dashboard-stats";

// ─────────────────────────────────────────────────────────────────
// Same card geometry as the conference widget so the dashboard row
// reads as one family. Navy rather than red — it reuses the INK tone
// already used as the ink colour in the renewals widget.
// ─────────────────────────────────────────────────────────────────

const CARD_W = 372.29;
const CARD_H = 309.98;
const CARD_R = 34.99;

const FONT = "var(--font-primary)";
const INK = "#ffffff";
const FAINT = "#f2f2f2";

const STAT_COLUMNS = [
  { key: "open", label: "Open Actions", x: 38.65 },
  { key: "overdue", label: "Overdue", x: 155.67 },
  { key: "minutes", label: "Minutes Due", x: 271.88 },
] as const;

const DIVIDER_X = [131.78, 238.5];

/** Timeline band the upcoming-meeting ticks sit on. */
const BAND = { x0: 38, x1: 348, y: 170 };

function formatMeetingDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function countdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `${daysUntil} days`;
}

function DotsMenu() {
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
    { href: "/admin/board/meetings", label: "Meetings" },
    { href: "/admin/board/financials", label: "Financials" },
    { href: "/admin/board/settings", label: "Board settings" },
  ];

  return (
    <div ref={ref} className="absolute" style={{ top: "13.5%", right: "6.5%" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Board widget options"
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

export function BoardWidget({ data }: { data: BoardDashboardStats }) {
  const { nextMeeting, upcoming, openActionItems, overdueActionItems, minutesOutstanding } = data;

  const headline = nextMeeting ? countdownLabel(nextMeeting.daysUntil) : "None";
  const caption = nextMeeting
    ? `Next meeting · ${formatMeetingDate(nextMeeting.meetingDate)}`
    : "No meeting scheduled";

  const counts: Record<string, number> = {
    open: openActionItems,
    overdue: overdueActionItems,
    minutes: minutesOutstanding,
  };

  // Ticks are spaced by actual days out, so the gaps carry meaning rather
  // than just being evenly distributed decoration.
  const horizon = Math.max(...upcoming.map((m) => m.daysUntil), 1);

  return (
    <div
      className="relative"
      style={{ width: CARD_W, maxWidth: "100%", aspectRatio: `${CARD_W} / ${CARD_H}` }}
    >
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={
          nextMeeting
            ? `Board: next meeting ${nextMeeting.meetingDate}, ${openActionItems} open action items, ${overdueActionItems} overdue, ${minutesOutstanding} ${minutesOutstanding === 1 ? "set" : "sets"} of minutes outstanding`
            : `Board: no meeting scheduled, ${openActionItems} open action items`
        }
      >
        <defs>
          <linearGradient id="csc-board-widget-bg" x1="0" y1="154.99" x2={CARD_W} y2="154.99" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#16345a" />
            <stop offset="1" stopColor="#0b1f38" />
          </linearGradient>
        </defs>

        <rect width={CARD_W} height={CARD_H} rx={CARD_R} ry={CARD_R} fill="url(#csc-board-widget-bg)" />

        <text x="39.2" y="54.27" fill={INK} style={{ fontFamily: FONT, fontSize: 18, fontWeight: 400 }}>
          The Board
        </text>

        <text
          x="39.2"
          y="111.55"
          fill={INK}
          style={{ fontFamily: FONT, fontSize: 43, fontWeight: 700 }}
        >
          {headline}
        </text>

        <text x="39.2" y="136" fill={FAINT} opacity={0.85} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 400 }}>
          {caption}
        </text>

        {/* Upcoming-meeting timeline */}
        {upcoming.length > 0 && (
          <g>
            <line
              x1={BAND.x0}
              x2={BAND.x1}
              y1={BAND.y}
              y2={BAND.y}
              stroke={FAINT}
              strokeWidth={0.5}
              opacity={0.5}
            />
            {upcoming.map((meeting, i) => {
              const x = BAND.x0 + (meeting.daysUntil / horizon) * (BAND.x1 - BAND.x0);
              const isNext = i === 0;
              return (
                <g key={meeting.id}>
                  <circle cx={x} cy={BAND.y} r={isNext ? 6 : 3} fill={INK} opacity={isNext ? 1 : 0.5} />
                  {isNext && (
                    <text
                      x={x}
                      y={BAND.y + 22}
                      fill={INK}
                      textAnchor="middle"
                      style={{ fontFamily: FONT, fontSize: 10, fontWeight: 500 }}
                    >
                      {formatMeetingDate(meeting.meetingDate)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {DIVIDER_X.map((x) => (
          <line key={x} x1={x} x2={x} y1="217.72" y2="274.93" stroke={INK} strokeDasharray="3" strokeMiterlimit={10} />
        ))}

        {STAT_COLUMNS.map(({ key, label, x }) => {
          const value = counts[key];
          // Overdue and outstanding minutes are failures, not neutral counts —
          // dim them at zero so a clean board doesn't read as an alert.
          const isProblem = (key === "overdue" || key === "minutes") && value > 0;
          return (
            <g key={key}>
              <text
                x={x}
                y="231.24"
                fill={INK}
                opacity={0.82}
                style={{ fontFamily: FONT, fontSize: 14, fontWeight: 400 }}
              >
                {label}
              </text>
              <text
                x={x}
                y="267.26"
                fill={isProblem ? "#ff8a8a" : FAINT}
                opacity={value === 0 ? 0.45 : 1}
                style={{ fontFamily: FONT, fontSize: 22, fontWeight: 500 }}
              >
                {value}
              </text>
            </g>
          );
        })}
      </svg>

      <DotsMenu />
    </div>
  );
}
