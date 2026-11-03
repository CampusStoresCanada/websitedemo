"use client";

import { useState } from "react";
import { askCsc } from "@/lib/actions/flags";

/**
 * "Ask CSC" at the top of someone's own conference page (Stephen, 2026-10-22).
 *
 * A control, not a channel: it raises a flag (askCsc → submitFlag), so Butler
 * Ghost opens the usual Circle room with CSC staff and the War Room keeps the
 * record. Who they are, their booth and where they are now are added on the
 * server — they only say what they need.
 */
export default function AskCscBox({ conferenceId }: { conferenceId: string }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        Sent. CSC staff have it and will reply in Circle, or come and find you.{" "}
        <button type="button" onClick={() => setSent(false)} className="font-medium underline">
          Ask something else
        </button>
      </div>
    );
  }

  return (
    <form
      className="rounded-xl border border-gray-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await askCsc({ conferenceId, note });
        setBusy(false);
        if (!result.success) {
          setError(result.error ?? "Couldn't send that.");
          return;
        }
        setNote("");
        setSent(true);
      }}
    >
      <label htmlFor="ask-csc" className="text-sm font-semibold text-gray-900">
        Ask CSC
      </label>
      <p className="mt-0.5 text-xs text-gray-600">
        Need something at the conference? Tell us here. For anything urgent, call the number on your badge.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <textarea
          id="ask-csc"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. My 10:30 meeting didn't show"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !note.trim()}
          className="self-end rounded-md bg-[#163D6D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#12325a] disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}
