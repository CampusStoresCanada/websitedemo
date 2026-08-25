"use client";

import { useState, useTransition } from "react";
import { sendConsentAsk } from "@/lib/actions/consent-ask";

export interface ConsentAskStats {
  publicationId: string;
  listed: number;
  decided: number;
  undecided: number;
  askable: number;
  noEmail: number;
  alreadyAsked: number;
  suppressed: number;
  sample: { name: string; orgName: string; email: string }[];
}

/**
 * The state of the per-person ask, and the button that runs it.
 *
 * Shows the numbers before it will send anything, and requires a second click
 * to confirm — this mails hundreds of individuals about their own privacy, and
 * it should not be one stray click away.
 */
export default function ConsentAskPanel({ stats }: { stats: ConsentAskStats }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await sendConsentAsk(stats.publicationId, stats.askable);
      if (r.success) setResult(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`);
      else setError(r.error ?? "Something went wrong.");
      setConfirming(false);
    });
  }

  const printable = stats.decided;

  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Asking people about their listing</h2>
      <p className="mt-1 text-xs text-gray-500">
        Each person decides for themselves. Nobody is printed without their own yes, so anyone
        not reached simply stays out of the book.
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
        <Stat label="Listed people" value={stats.listed} />
        <Stat label="Have decided" value={stats.decided} tone={printable > 0 ? "good" : "muted"} />
        <Stat label="Haven't decided" value={stats.undecided} />
        <Stat label="Ready to ask" value={stats.askable} tone="accent" />
      </dl>

      {(stats.noEmail > 0 || stats.alreadyAsked > 0 || stats.suppressed > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-gray-500">
          {stats.alreadyAsked > 0 && (
            <li>{stats.alreadyAsked} already asked and still silent — not re-asked in this run.</li>
          )}
          {stats.noEmail > 0 && (
            <li>{stats.noEmail} have no name or email on file, so they cannot be asked at all.</li>
          )}
          {stats.suppressed > 0 && (
            <li>
              {stats.suppressed} are on the suppression list and won&rsquo;t be mailed — they
              stay unprinted.
            </li>
          )}
        </ul>
      )}

      {stats.sample.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[#163D6D]">
            Who would be asked first
          </summary>
          <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
            {stats.sample.map((s) => (
              <li key={s.email}>
                {s.name} — {s.orgName} · {s.email}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {stats.askable === 0 ? (
          <p className="text-xs text-gray-500">Nobody is waiting to be asked.</p>
        ) : confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={send}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-60"
            >
              {pending ? "Sending…" : `Yes — email ${stats.askable} people now`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-[#163D6D] px-3 py-1.5 text-xs font-semibold text-[#163D6D] hover:bg-[#163D6D]/5"
          >
            Send the ask to {stats.askable}…
          </button>
        )}
      </div>

      {result && <p className="mt-2 text-xs text-green-700">{result}</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: string }) {
  const colour =
    tone === "accent" ? "text-[#163D6D]" : tone === "good" ? "text-green-700" : "text-gray-900";
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${colour}`}>{value}</dd>
    </div>
  );
}
