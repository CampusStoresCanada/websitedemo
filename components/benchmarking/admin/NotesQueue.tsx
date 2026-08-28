"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { secretaryDecide, overridePublish } from "@/lib/actions/benchmarking-notes";

/**
 * The lead deciding what gets said about a store's numbers.
 *
 * The override is the part that needs care. A store that never answers is not
 * a store that agreed, so silence can never publish on its own — but a report
 * that omits every unanswered explanation is a report full of unexplained
 * outliers. The way through is a deliberate act with a written reason that
 * travels with the note afterwards, so anyone reading the published figure can
 * see it ran without the store's agreement and why.
 */

interface Row {
  id: string;
  organizationName: string;
  fieldName: string;
  note: string;
  status: "secretary_review" | "respondent_review";
  createdAt: string;
  askedAt: string | null;
  respondentDecision: string | null;
  publishedOnOverride: boolean;
  overrideReason: string | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function fieldLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NotesQueue({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const mine = rows.filter((r) => r.status === "secretary_review");
  const waiting = rows.filter((r) => r.status === "respondent_review");

  async function decide(id: string, decision: "approved" | "declined") {
    setBusy(id);
    setError(null);
    const res = await secretaryDecide(id, decision);
    setBusy(null);
    if (!res.success) return setError(res.error ?? "Could not save that.");
    router.refresh();
  }

  async function doOverride(id: string) {
    const why = reason.trim();
    if (!why) return setError("Say why this is running without the store's agreement.");
    setBusy(id);
    setError(null);
    const res = await overridePublish(id, why);
    setBusy(null);
    if (!res.success) return setError(res.error ?? "Could not publish that.");
    setOverriding(null);
    setReason("");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Explanations</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        Notes a reviewer has written about a store&rsquo;s figures. Nothing here has been
        published — a note is only ever shown to other members once the store it
        describes has agreed to it.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold text-gray-900">
          Waiting on you{mine.length > 0 && ` · ${mine.length}`}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          A reviewer wrote this. Approving sends it to the store to check before anyone
          else sees it; declining keeps it internal.
        </p>

        {mine.length === 0 ? (
          <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            Nothing waiting.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {mine.map((r) => (
              <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">{r.organizationName}</span>
                  <span className="text-xs text-gray-500">{fieldLabel(r.fieldName)}</span>
                </div>
                <p className="mt-2 text-sm text-gray-800">{r.note}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => decide(r.id, "approved")}
                    className="rounded-lg bg-[#163D6D] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Send to the store
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => decide(r.id, "declined")}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                  >
                    Keep internal
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-gray-900">
          With the store{waiting.length > 0 && ` · ${waiting.length}`}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Asked and not yet answered. Silence is a legitimate answer — these stay unpublished
          unless you deliberately override, and an override carries your reason with it.
        </p>

        {waiting.length === 0 ? (
          <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            Nothing outstanding.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {waiting.map((r) => {
              const days = daysSince(r.askedAt);
              return (
                <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-900">{r.organizationName}</span>
                    <span className="text-xs text-gray-500">
                      {fieldLabel(r.fieldName)}
                      {days !== null && (
                        <> · asked {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}</>
                      )}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-800">{r.note}</p>

                  {overriding === r.id ? (
                    <div className="mt-3 rounded-lg bg-amber-50 p-3">
                      <label className="block text-sm text-amber-900">
                        This will publish without {r.organizationName} having agreed. Say why
                        — it is shown alongside the note afterwards.
                      </label>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
                        placeholder="e.g. Asked twice by email and once by phone, no reply; the figure is materially misleading without this note."
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => doOverride(r.id)}
                          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          Publish anyway
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverriding(null);
                            setReason("");
                          }}
                          className="rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOverriding(r.id);
                        setReason("");
                        setError(null);
                      }}
                      className="mt-3 text-sm font-medium text-amber-800 underline"
                    >
                      Publish without their answer
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
