"use client";

import { useState } from "react";
import {
  addStoreContact,
  type StoreContact,
} from "@/lib/actions/benchmarking-respondent";

/**
 * Who actually posts, by name, when the answer is somebody on staff.
 *
 * "Store staff, as part of their job" describes the arrangement but not the
 * person, and the person is the useful half: they are who a peer asks how a
 * campaign went, and who CSC invites when it runs something on social.
 *
 * ⛔ Skippable, and said so on screen. Some stores will not want a student
 * employee's name in a national association's records, and that is a good
 * reason rather than an awkward one. Nothing downstream requires an answer, so
 * declining costs the store nothing at all.
 *
 * ⛔ Only offered where the answer is internal. An agency is not in our
 * contacts and never will be, and asking anyway would invite a store to type a
 * company into a field that points at people.
 */

/** Answers that mean somebody on the store's own staff does it. */
const INTERNAL_ANSWERS = [
  "Store staff, as part of their job",
  "A student employee",
  "A dedicated marketing person",
];

export function isInternalSocialAnswer(value: unknown): boolean {
  return typeof value === "string" && INTERNAL_ANSWERS.includes(value);
}

export default function SocialOwner({
  benchmarkingId,
  contacts,
  value,
  onChange,
  isReadOnly,
}: {
  benchmarkingId: string;
  contacts: StoreContact[];
  value: string | null;
  onChange: (contactId: string | null) => void;
  isReadOnly: boolean;
}) {
  const [people, setPeople] = useState<StoreContact[]>(contacts);
  const [selected, setSelected] = useState<string | null>(value);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", roleTitle: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    const res = await addStoreContact({
      benchmarkingId,
      name: draft.name,
      email: draft.email,
      roleTitle: draft.roleTitle || undefined,
    });
    setSaving(false);
    if (!res.success || !res.contact) {
      setError(res.error ?? "Could not add that person.");
      return;
    }
    setPeople((p) => [...p, res.contact!]);
    setSelected(res.contact.id);
    onChange(res.contact.id);
    setAddingNew(false);
    setDraft({ name: "", email: "", roleTitle: "" });
  }

  return (
    <div className="mb-4 pl-4">
      <label className="block text-sm font-medium text-gray-700">
        Who is that, exactly?
      </label>
      <p className="mt-1 text-sm text-gray-500">
        So a peer asking how a campaign went reaches the person who ran it rather than
        your general inbox. Nothing is published. This sits on your store record.
      </p>
      <p className="mt-1 text-sm text-gray-500">
        Leave it blank if you would rather not name anyone. Plenty of stores will not
        want a student employee in a national association&apos;s records, and skipping
        this costs you nothing.
      </p>

      {!addingNew && (
        <select
          value={selected ?? ""}
          disabled={isReadOnly}
          onChange={(e) => {
            if (e.target.value === "__new") {
              setAddingNew(true);
              return;
            }
            const id = e.target.value || null;
            setSelected(id);
            onChange(id);
          }}
          className="mt-2 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Rather not say</option>
          {people.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.roleTitle ? ` (${c.roleTitle})` : ""}
            </option>
          ))}
          <option value="__new">Someone else, add them here…</option>
        </select>
      )}

      {addingNew && !isReadOnly && (
        <div className="mt-2 max-w-sm space-y-2">
          <p className="text-xs text-gray-600">
            This adds them to your store&apos;s contacts, so you will not type it again
            next year. It does not list them anywhere public.
          </p>
          {(
            [
              ["name", "Name"],
              ["email", "Email"],
              ["roleTitle", "Job title (optional)"],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              type={key === "email" ? "email" : "text"}
              value={draft[key]}
              placeholder={label}
              aria-label={label}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          ))}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void add()}
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

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
