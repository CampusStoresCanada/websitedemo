"use client";

import { useState, useTransition } from "react";
import type { BoardRenewalReport, BoardRenewalTypeReport } from "@/lib/renewal/board-report";
import type { RenewalOrgType } from "@/lib/renewal/renewal-progress";
import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  CHANNEL_LABEL,
  OUTCOME_LABEL,
  type ContactChannel,
  type ContactOutcome,
} from "@/lib/renewal/outreach";
import { logRenewalContactAction } from "@/lib/actions/renewal-outreach";

interface Props {
  report: BoardRenewalReport;
  meetingDate: string;
  eventSlug: string;
}

/**
 * Logging a call has to be a byproduct of working the list, not a second
 * screen. contacts.last_contact_date already exists and is populated on 12 of
 * 952 rows — the field was never the problem, the extra step was. So the form
 * opens in place on the row the caller is already looking at.
 */
function LogContactForm({
  organizationId,
  renewalYear,
  eventSlug,
  onDone,
}: {
  organizationId: string;
  renewalYear: number;
  eventSlug: string;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [outcome, setOutcome] = useState<ContactOutcome>("undecided");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await logRenewalContactAction({
        organizationId,
        renewalYear,
        channel,
        outcome,
        note: note || null,
        eventSlug,
      });
      if (res.success) onDone();
      else setError(res.error ?? "Could not save.");
    });
  };

  return (
    <div className="mt-2 mb-1 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`ch-${organizationId}`}>How</label>
        <select
          id={`ch-${organizationId}`}
          value={channel}
          onChange={(e) => setChannel(e.target.value as ContactChannel)}
          className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
        >
          {CONTACT_CHANNELS.map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`oc-${organizationId}`}>Outcome</label>
        <select
          id={`oc-${organizationId}`}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as ContactOutcome)}
          className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
        >
          {CONTACT_OUTCOMES.map((o) => (
            <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What did they say? This is the part worth having next August."
        className="w-full text-sm rounded border border-gray-300 px-2 py-1.5 bg-white"
      />
      {error && <p className="text-xs text-[#9C0006]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-[#163D6D] text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
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

function TypePanel({
  type,
  renewalYear,
  eventSlug,
}: {
  type: BoardRenewalTypeReport;
  renewalYear: number;
  eventSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
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
          <p className="text-xs text-gray-500 mb-2">
            {type.contactedCount} of {type.outstanding.length} spoken to
            {type.assignedCount > 0 && ` · ${type.assignedCount} assigned`}
            {type.contactedCount === 0 && type.outstanding.length > 0 && (
              <span className="text-[#9C0006] font-medium"> — nobody has been called yet</span>
            )}
          </p>
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
                <li key={org.organizationId} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-700 min-w-0 truncate">{org.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {org.lastContactedAt ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-800"
                          title={`${org.contactCount} contact${org.contactCount === 1 ? "" : "s"} logged`}
                        >
                          spoken to
                        </span>
                      ) : org.assignedTo ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">
                          assigned
                        </span>
                      ) : null}
                      <span className="text-gray-500 tabular-nums">{money(org.amountCents)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setLogging((v) => (v === org.organizationId ? null : org.organizationId))
                        }
                        className="text-xs font-semibold text-[#EE2A2E] hover:underline"
                      >
                        {logging === org.organizationId ? "Close" : "Log contact"}
                      </button>
                    </span>
                  </div>
                  {logging === org.organizationId && (
                    <LogContactForm
                      organizationId={org.organizationId}
                      renewalYear={renewalYear}
                      eventSlug={eventSlug}
                      onDone={() => setLogging(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingRenewalsTab({ report, meetingDate, eventSlug }: Props) {
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
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
          <Stat
            label="Spoken to"
            value={`${totals.contactedCount} / ${totals.outstandingCount}`}
            hint={
              totals.outstandingCount === 0
                ? "nothing outstanding"
                : `${totals.assignedCount} assigned to someone`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {orgTypes.map((key) => (
          <TypePanel
            key={key}
            type={report.types[key]}
            renewalYear={report.renewalYear}
            eventSlug={eventSlug}
          />
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
