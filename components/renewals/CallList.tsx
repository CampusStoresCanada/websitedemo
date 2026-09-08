"use client";

import { useState, useTransition } from "react";
import LocalDate from "@/components/ui/LocalDate";
import type { RenewalCallList, CallListEntry } from "@/lib/renewal/call-list";
import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  CHANNEL_LABEL,
  OUTCOME_LABEL,
  type ContactChannel,
  type ContactOutcome,
} from "@/lib/renewal/outreach";
import { logRenewalContactAction } from "@/lib/actions/renewal-outreach";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
  });
}

const OUTCOME_TONE: Record<ContactOutcome, string> = {
  renewing: "bg-green-50 text-green-800",
  undecided: "bg-amber-50 text-amber-800",
  not_renewing: "bg-red-50 text-red-800",
  no_response: "bg-gray-100 text-gray-600",
  other: "bg-gray-100 text-gray-600",
};

function Entry({ entry, renewalYear }: { entry: CallListEntry; renewalYear: number }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [outcome, setOutcome] = useState<ContactOutcome>("undecided");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await logRenewalContactAction({
        organizationId: entry.organizationId,
        renewalYear,
        channel,
        outcome,
        note: note || null,
      });
      if (res.success) {
        setNote("");
        setOpen(false);
      } else setError(res.error ?? "Could not save.");
    });
  };

  const last = entry.history[0];

  return (
    <li className={`rounded-xl border p-4 ${entry.renewed ? "border-green-200 bg-green-50/40" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-800">
            {entry.organizationName}
            {entry.renewed && (
              <span className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-800">
                renewed
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {[entry.orgType, entry.province].filter(Boolean).join(" · ")}
            {entry.amountCents > 0 &&
              ` · ${money(entry.amountCents)} ${entry.renewed ? "paid" : "outstanding"}`}
          </p>
        </div>
        {!entry.renewed && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-[#163D6D] text-white shrink-0"
          >
            {open ? "Close" : last ? "Log another call" : "Log a call"}
          </button>
        )}
      </div>

      {/* Who to ring. The point of the page. */}
      {entry.contact ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-700 font-medium">{entry.contact.name}</span>
          {entry.contact.roleTitle && (
            <span className="text-gray-500 text-xs">{entry.contact.roleTitle}</span>
          )}
          {entry.contact.phone && (
            <a href={`tel:${entry.contact.phone.replace(/[^\d+]/g, "")}`} className="text-[#EE2A2E] hover:underline">
              {entry.contact.phone}
            </a>
          )}
          {entry.contact.email && (
            <a href={`mailto:${entry.contact.email}`} className="text-[#EE2A2E] hover:underline">
              {entry.contact.email}
            </a>
          )}
          {!entry.contact.isPrimary && (
            <span className="text-xs text-amber-700">no primary contact flagged</span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-700">No contact on file — ask the office.</p>
      )}

      {/* What happened last time. The part worth having next August. */}
      {entry.history.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2 space-y-1.5">
          {entry.history.map((h) => (
            <div key={h.id} className="text-sm">
              <span className={`text-xs px-1.5 py-0.5 rounded ${OUTCOME_TONE[h.outcome]}`}>
                {OUTCOME_LABEL[h.outcome]}
              </span>
              <span className="text-xs text-gray-400 ml-2">
                {CHANNEL_LABEL[h.channel]} · <LocalDate iso={h.contactedAt} format="short" />
              </span>
              {h.note && <p className="text-gray-700 mt-0.5">{h.note}</p>}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ContactChannel)}
              className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
              aria-label="How you contacted them"
            >
              {CONTACT_CHANNELS.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
              ))}
            </select>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ContactOutcome)}
              className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
              aria-label="How it went"
            >
              {CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
              ))}
            </select>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did they say? Write it as you'd want to read it next August."
            className="w-full text-sm rounded border border-gray-300 px-2 py-1.5 bg-white"
          />
          {error && <p className="text-xs text-[#9C0006]">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-[#163D6D] text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </li>
  );
}

export default function CallList({ list }: { list: RenewalCallList }) {
  return (
    <ul className="space-y-3">
      {list.entries.map((e) => (
        <Entry key={e.organizationId} entry={e} renewalYear={list.renewalYear} />
      ))}
    </ul>
  );
}
