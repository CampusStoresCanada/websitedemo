"use client";

import { useState } from "react";
import type { StoreContact } from "@/lib/actions/benchmarking-respondent";

/**
 * Who actually posts, by name — when the answer is somebody on staff.
 *
 * "Store staff, as part of their job" describes the arrangement but not the
 * person, and the person is the useful half: they are who a peer asks how a
 * campaign went, and who CSC invites when it runs something on social. The
 * same shape as the category buyers in §2 — a name we already hold, confirmed
 * rather than retyped.
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
  contacts,
  value,
  onChange,
  isReadOnly,
}: {
  contacts: StoreContact[];
  value: string | null;
  onChange: (contactId: string | null) => void;
  isReadOnly: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(value);

  return (
    <div className="mb-4 pl-4">
      <label className="block text-sm font-medium text-gray-700">
        Who is that, exactly?
      </label>
      <p className="mt-1 text-sm text-gray-500">
        So a peer asking how a campaign went reaches the person who ran it, rather than
        your general inbox. Nothing is published — this sits on your store record.
      </p>
      {contacts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          We do not have anyone on file for your store yet. Add your people in Section 1
          and they will appear here.
        </p>
      ) : (
        <select
          value={selected ?? ""}
          disabled={isReadOnly}
          onChange={(e) => {
            const id = e.target.value || null;
            setSelected(id);
            onChange(id);
          }}
          className="mt-2 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Choose a person…</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.roleTitle ? ` — ${c.roleTitle}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
