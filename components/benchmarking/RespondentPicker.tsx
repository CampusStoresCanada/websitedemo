"use client";

import { useState } from "react";
import { setRespondent, type StoreContact } from "@/lib/actions/benchmarking-respondent";

/**
 * Who is filling this in — picked, not retyped.
 *
 * This was four free-text boxes: name, title, email, phone. Every year, for a
 * person CSC already holds a contact record for, typed by the store admin who
 * is signed in and is usually the answer. So it defaults to them, offers the
 * rest of the store's people, and only asks for typing when it is genuinely
 * somebody new.
 *
 * The checkbox is the part that matters operationally: if the admin hands this
 * to a colleague, that colleague needs to be able to open it. That grants
 * access to THIS submission and nothing else — see setRespondent.
 */
export default function RespondentPicker({
  benchmarkingId,
  contacts,
  initialContactId,
  initialDelegated,
  isReadOnly,
}: {
  benchmarkingId: string;
  contacts: StoreContact[];
  initialContactId: string | null;
  initialDelegated: boolean;
  isReadOnly: boolean;
}) {
  const you = contacts.find((c) => c.isYou) ?? null;
  const [selected, setSelected] = useState<string>(
    initialContactId ?? you?.id ?? "",
  );
  const [addingNew, setAddingNew] = useState(false);
  const [grantAccess, setGrantAccess] = useState(initialDelegated);
  const [draft, setDraft] = useState({ name: "", email: "", roleTitle: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = contacts.find((c) => c.id === selected) ?? null;
  const isSomeoneElse = Boolean(chosen && !chosen.isYou) || addingNew;

  async function save(next: { contactId?: string | null; grant?: boolean }) {
    setSaving(true);
    setError(null);
    setStatus(null);
    const res = await setRespondent({
      benchmarkingId,
      contactId: next.contactId !== undefined ? next.contactId : selected || null,
      grantAccess: next.grant !== undefined ? next.grant : grantAccess,
      ...(addingNew && !next.contactId
        ? { newContact: { name: draft.name, email: draft.email, roleTitle: draft.roleTitle, phone: draft.phone } }
        : {}),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    if (res.createdContactId) {
      setSelected(res.createdContactId);
      setAddingNew(false);
      setDraft({ name: "", email: "", roleTitle: "", phone: "" });
    }
    setStatus("Saved.");
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-medium text-gray-900">Who is filling this in</h3>
      <p className="mt-1 text-xs text-gray-600">
        Usually you. If a colleague is pulling the numbers together, name them here so a
        question in November reaches them and not you.
      </p>

      {!addingNew && (
        <div className="mt-3">
          <select
            value={selected}
            disabled={isReadOnly || saving}
            onChange={(e) => {
              if (e.target.value === "__new") {
                setAddingNew(true);
                return;
              }
              setSelected(e.target.value);
              void save({ contactId: e.target.value });
            }}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Choose a person…
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isYou ? " (you)" : ""}
                {c.roleTitle ? ` — ${c.roleTitle}` : ""}
              </option>
            ))}
            <option value="__new">Someone else — add them…</option>
          </select>

          {chosen && (
            <p className="mt-1 text-xs text-gray-500">
              {chosen.email ?? "No email on file"}
              {chosen.phone ? ` · ${chosen.phone}` : ""}
            </p>
          )}
        </div>
      )}

      {addingNew && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-600">
            This adds them to your store&apos;s contacts, so you will not have to type it
            again next year. It does not list them anywhere public.
          </p>
          {(
            [
              ["name", "Name", true],
              ["email", "Work email", true],
              ["roleTitle", "Job title", false],
              ["phone", "Phone", false],
            ] as const
          ).map(([key, label, required]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-700">
                {label}
                {required && <span className="ml-1 text-red-500">*</span>}
              </label>
              <input
                type="text"
                value={draft[key]}
                disabled={saving}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void save({})}
              disabled={saving || !draft.name.trim() || !draft.email.trim()}
              className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Adding…" : "Add them"}
            </button>
            <button
              onClick={() => {
                setAddingNew(false);
                setError(null);
              }}
              className="text-sm text-gray-600 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isSomeoneElse && !addingNew && (
        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={grantAccess}
            disabled={isReadOnly || saving || !chosen?.hasLogin}
            onChange={(e) => {
              setGrantAccess(e.target.checked);
              void save({ grant: e.target.checked });
            }}
          />
          <span className="text-sm text-gray-800">
            Let them sign in and complete this survey
            {!chosen?.hasLogin && (
              <span className="block text-xs text-gray-500">
                {chosen?.name} does not have a login yet, so there is nothing to give
                access to. Ask CSC to set one up.
              </span>
            )}
            {chosen?.hasLogin && (
              <span className="block text-xs text-gray-500">
                This survey only. It does not let them manage your store&apos;s users,
                billing or listing.
              </span>
            )}
          </span>
        </label>
      )}

      <div className="mt-2 min-h-[18px] text-xs" aria-live="polite">
        {saving && <span className="text-gray-500">Saving…</span>}
        {!saving && status && <span className="text-green-700">{status}</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  );
}
