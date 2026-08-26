"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveRecipient } from "@/lib/actions/benchmarking-recipients";

interface ContactOption {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  isPrimary: boolean;
}

interface Item {
  id: string;
  status: string;
  note: string | null;
  contactId: string | null;
  orgName: string;
  province: string;
  region: string;
  participatedLastYear: boolean;
  contacts: ContactOption[];
}

export default function RecipientQueue({
  surveyTitle,
  fiscalYear,
  isAdmin,
  items,
}: {
  surveyTitle: string;
  fiscalYear: number;
  isAdmin: boolean;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const done = useMemo(
    () =>
      items.filter((i) => i.status === "confirmed" || i.status === "corrected"),
    [items],
  );
  const escalated = useMemo(
    () => items.filter((i) => i.status === "escalated"),
    [items],
  );
  const todo = useMemo(
    () => items.filter((i) => i.status === "unconfirmed"),
    [items],
  );

  const visible = showDone ? done : todo;

  const act = async (
    id: string,
    outcome: "confirmed" | "corrected" | "unknown",
    contactId?: string | null,
  ) => {
    setBusy(id);
    setError(null);
    const result = await resolveRecipient({
      recipientId: id,
      outcome,
      contactId: contactId ?? null,
    });
    if (result.success) router.refresh();
    else setError(result.error ?? "Could not save");
    setBusy(null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
          {surveyTitle} &middot; FY{fiscalYear}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Who should get the survey?
        </h1>
        <p className="text-sm text-gray-600">
          For each store: is this still the right person? Confirm, pick someone
          else, or say you don&rsquo;t know.{" "}
          <strong>Don&rsquo;t know is a perfectly good answer</strong> and much
          more useful than a guess — it sends the store back to the office
          rather than a survey to a dead inbox.
        </p>
      </header>

      <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-200">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{done.length}</span> of{" "}
          {items.length} confirmed
          {escalated.length > 0 && (
            <span className="text-gray-400">
              {" "}
              · {escalated.length} with the office
            </span>
          )}
        </p>
        <button
          onClick={() => setShowDone((v) => !v)}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
        >
          {showDone ? `Back to the ${todo.length} to do` : "See what's done"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      {visible.length === 0 && (
        <p className="text-sm text-gray-500 py-10 text-center bg-gray-50 rounded-lg">
          {showDone
            ? "Nothing confirmed yet."
            : "Nothing left in your queue. Thank you — genuinely."}
        </p>
      )}

      <div className="space-y-3">
        {visible.map((item) => (
          <StoreCard
            key={item.id}
            item={item}
            busy={busy === item.id}
            onAct={act}
          />
        ))}
      </div>

      {isAdmin && escalated.length > 0 && !showDone && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            With the office ({escalated.length})
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Either nobody on file to ask about, or a rep said they didn&rsquo;t
            know. These don&rsquo;t sit in anyone&rsquo;s queue going stale.
          </p>
          <ul className="space-y-1">
            {escalated.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded text-sm"
              >
                <span className="text-gray-900">{e.orgName}</span>
                <span className="text-xs text-amber-800">
                  {e.contacts.length === 0
                    ? "no contacts on file"
                    : "rep didn't know"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function StoreCard({
  item,
  busy,
  onAct,
}: {
  item: Item;
  busy: boolean;
  onAct: (
    id: string,
    outcome: "confirmed" | "corrected" | "unknown",
    contactId?: string | null,
  ) => void;
}) {
  const suggested =
    item.contacts.find((c) => c.id === item.contactId) ??
    item.contacts.find((c) => c.isPrimary) ??
    null;
  const [picking, setPicking] = useState(false);

  const isDone = item.status === "confirmed" || item.status === "corrected";

  return (
    <div
      className={`border rounded-lg bg-white p-4 ${
        isDone ? "border-gray-200" : "border-gray-300"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {item.orgName}
          </h3>
          <p className="text-xs text-gray-400">
            {item.province} · {item.region}
          </p>
        </div>
        {!item.participatedLastYear && (
          <span className="shrink-0 text-[11px] font-medium px-2 py-1 rounded bg-amber-50 text-amber-800">
            Didn&rsquo;t take part last year
          </span>
        )}
      </div>

      {suggested ? (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-sm font-medium text-gray-900">{suggested.name}</p>
          <p className="text-xs text-gray-500">
            {suggested.roleTitle ?? "no title on file"}
            {suggested.email ? ` · ${suggested.email}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-800">
          Nobody on file for this store.
        </p>
      )}

      {isDone ? (
        <p className="mt-3 text-xs text-green-700">
          {item.status === "corrected" ? "Corrected" : "Confirmed"}
        </p>
      ) : (
        <>
          {picking && (
            <ul className="mt-3 border border-gray-200 rounded divide-y divide-gray-100 max-h-52 overflow-y-auto">
              {item.contacts
                .filter((c) => c.id !== suggested?.id)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => onAct(item.id, "corrected", c.id)}
                      disabled={busy}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="text-sm text-gray-900">{c.name}</span>
                      <span className="block text-xs text-gray-500">
                        {c.roleTitle ?? "no title on file"}
                      </span>
                    </button>
                  </li>
                ))}
              {item.contacts.filter((c) => c.id !== suggested?.id).length ===
                0 && (
                <li className="px-3 py-2 text-xs text-gray-500">
                  No one else on file for this store.
                </li>
              )}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {suggested && (
              <button
                onClick={() => onAct(item.id, "confirmed", suggested.id)}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? "…" : "That's them"}
              </button>
            )}
            <button
              onClick={() => setPicking((v) => !v)}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {picking ? "Never mind" : "It's someone else"}
            </button>
            <button
              onClick={() => onAct(item.id, "unknown")}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              I don&rsquo;t know
            </button>
          </div>
        </>
      )}
    </div>
  );
}
