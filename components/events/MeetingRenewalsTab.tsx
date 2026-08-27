"use client";

import { useState } from "react";
import type { BoardRenewalReport, BoardRenewalTypeReport } from "@/lib/renewal/board-report";
import type { RenewalOrgType } from "@/lib/renewal/renewal-progress";

interface Props {
  report: BoardRenewalReport;
  meetingDate: string;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

const TYPE_LABEL: Record<string, string> = {
  Member: "Members",
  "Vendor Partner": "Vendor Partners",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold text-[#163D6D] mt-0.5 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function TypePanel({ type }: { type: BoardRenewalTypeReport }) {
  const [open, setOpen] = useState(false);
  const renewedPct = type.populationCount === 0 ? 0 : type.renewedCount / type.populationCount;

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {TYPE_LABEL[type.orgType] ?? type.orgType}
        </h3>
        <span className="text-xs text-gray-500 tabular-nums">
          {type.renewedCount} of {type.populationCount} renewed ·{" "}
          {pct(type.renewedCount, type.populationCount)}
        </span>
      </div>

      <div
        className="h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-4"
        role="img"
        aria-label={`${pct(type.renewedCount, type.populationCount)} renewed`}
      >
        <div
          className="h-full rounded-full bg-[#163D6D] transition-all"
          style={{ width: `${Math.round(renewedPct * 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Stat label="Collected" value={money(type.collectedCents)} hint="excludes tax" />
        <Stat
          label="Outstanding"
          value={money(type.outstandingCents)}
          hint={`${type.outstanding.length} ${
            type.outstanding.length === 1 ? "organization" : "organizations"
          }`}
        />
      </div>

      {type.outstanding.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#EE2A2E] hover:underline"
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} the {type.outstanding.length} still to renew
            <svg
              className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
              {type.outstanding.map((org) => (
                <li
                  key={org.organizationId}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
                  <span className="text-gray-700">{org.name}</span>
                  <span className="text-gray-500 tabular-nums">{money(org.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingRenewalsTab({ report, meetingDate }: Props) {
  const { totals } = report;
  const orgTypes = Object.keys(report.types) as RenewalOrgType[];

  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700">
          Renewal Progress — {report.cycleLabel} cycle
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Live as of this page load · meeting {meetingDate}. Figures exclude tax.
        </p>
      </div>

      {/* Headline — the number the board is being asked to act on */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-5 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat
            label="Renewed"
            value={`${totals.renewedCount} / ${totals.populationCount}`}
            hint={pct(totals.renewedCount, totals.populationCount)}
          />
          <Stat label="Collected" value={money(totals.collectedCents)} />
          <Stat label="Outstanding" value={money(totals.outstandingCents)} />
          <Stat
            label="Still to renew"
            value={String(totals.outstandingCount)}
            hint={
              totals.outstandingCount > 0
                ? "organizations needing contact"
                : "everyone is renewed"
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {orgTypes.map((key) => (
          <TypePanel key={key} type={report.types[key]} />
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Renewal is counted from the payment event, not invoice status — dues paid inside a
        booth checkout void the standalone invoice rather than paying it, and would otherwise
        read as unpaid.
      </p>
    </div>
  );
}
