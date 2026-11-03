"use client";

import { useState } from "react";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";
import { PRINT_SORT_KEYS, type PrintSortKey } from "@/lib/conference/badges/arrangement";
import { setMyPrintSort } from "@/lib/actions/profile";
import { sendDocumentToPrinter } from "@/lib/actions/conference-badges";


export type ConferencePerson = {
  id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  organization_id: string;
  assignment_status: string;
  badge_print_status: string;
  checked_in_at: string | null;
  travel_mode: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  dietary_restrictions: string | null;
  accessibility_needs: string | null;
  admin_notes: string | null;
};

/** A moment, in the operator's zone (Mountain): "22 October 2:04 p.m.". */
export function whenMountain(iso: string): string {
  return `${formatDayMonth(iso, "America/Edmonton") ?? ""} ${new Date(iso).toLocaleTimeString("en-CA", {
    timeZone: "America/Edmonton",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** "1 meeting", "3 meetings", "2 people". */
export function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : word === "person" ? "people" : `${word}s`}`;
}

/**
 * "Send to printer" on a task's document: onto the print station's queue, so it
 * is printing on the paper printer while you walk over to get it. Says so when
 * no station is online, because then nothing is printing it.
 */
export function SendToPrinterButton({ conferenceId, documentId }: { conferenceId: string; documentId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued_offline" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const label =
    state === "sending"
      ? "Sending…"
      : state === "sent"
        ? "Sent to printer"
        : state === "queued_offline"
          ? "Queued, but no print station is online"
          : "Send to printer";
  return (
    <>
      <button
        type="button"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          setError(null);
          const result = await sendDocumentToPrinter({ conferenceId, documentId });
          if (!result.success) {
            setState("error");
            setError(result.error);
            return;
          }
          setState(result.data.stationOnline ? "sent" : "queued_offline");
        }}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
          state === "sent"
            ? "bg-green-700 text-white"
            : state === "queued_offline"
              ? "bg-amber-600 text-white"
              : "bg-[#163D6D] text-white hover:bg-[#12325a]"
        }`}
      >
        {label}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </>
  );
}

const PRINT_SORT_LABELS: Record<PrintSortKey, string> = {
  person_first_name: "First name",
  person_last_name: "Last name",
  organization_name: "Organization",
};

/**
 * Set once, here, ahead of time: every printed name list (door lists, the
 * attendee list) comes out in this order for whoever prints it. Stephen: "it
 * shouldn't be while you are attempting the panic print on an iPad."
 */
function MyPrintSort({ initial }: { initial: PrintSortKey }) {
  const [sort, setSort] = useState<PrintSortKey>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-[18px] py-3">
      <span className="text-sm font-medium text-[#16345a]">My print sort</span>
      <div className="flex flex-wrap gap-1.5">
        {PRINT_SORT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={saving}
            aria-pressed={sort === key}
            onClick={async () => {
              if (sort === key) return;
              const previous = sort;
              setSort(key);
              setSaving(true);
              setError(null);
              const result = await setMyPrintSort(key);
              setSaving(false);
              if (!result.success) {
                setSort(previous);
                setError(result.error ?? "Couldn't save that.");
              }
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              sort === key ? "bg-[#163D6D] text-white" : "border border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {PRINT_SORT_LABELS[key]}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-500">
        {error ?? "Door lists and the attendee list print in this order for you."}
      </span>
    </section>
  );
}

/**
 * Personal settings, out of the way of the work: set once, rarely revisited.
 * Print sort used to sit above What's next, ahead of everything to do.
 */
export function MeMenu({ printSort }: { printSort: PrintSortKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Me ▾
      </button>
      {open ? (
        <>
          {/* Click anywhere else to close. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            <MyPrintSort initial={printSort} />
          </div>
        </>
      ) : null}
    </div>
  );
}

