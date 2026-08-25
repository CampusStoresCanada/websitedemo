"use client";

import { useState, useTransition } from "react";
import { setMyDirectoryVisibility } from "@/lib/actions/directory-visibility";
import {
  DIRECTORY_VISIBILITY_OPTIONS,
  type DirectoryVisibility,
} from "@/lib/contacts/visibility";

export interface VisibilityRow {
  contactId: string;
  orgName: string;
  name: string | null;
  roleTitle: string | null;
  choice: DirectoryVisibility | null;
}

/**
 * Where a person chooses to appear — one choice per organisation, because a
 * person at two stores may reasonably want different answers.
 *
 * Deliberately shows an UNANSWERED state rather than a pre-selected default.
 * A pre-ticked option is not a decision, and this is the thing that decides
 * whether their name and phone number go onto paper.
 */
export default function DirectoryVisibilityPanel({ rows }: { rows: VisibilityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">Where you appear</h2>
      <p className="mt-1 text-sm text-gray-600">
        You decide this, not your organisation. It covers the website and the printed
        directory together.
      </p>
      <div className="mt-4 space-y-4">
        {rows.map((row) => (
          <VisibilityChooser key={row.contactId} row={row} multiple={rows.length > 1} />
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Campus Stores Canada administrators can always see your details, whichever option you
        choose — they need them to run membership and billing.
      </p>
    </section>
  );
}

function VisibilityChooser({ row, multiple }: { row: VisibilityRow; multiple: boolean }) {
  const [choice, setChoice] = useState<DirectoryVisibility | null>(row.choice);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(next: DirectoryVisibility) {
    const previous = choice;
    setChoice(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setMyDirectoryVisibility(row.contactId, next);
      if (result.success) {
        setSaved(true);
      } else {
        // Put the control back where it was: leaving it on the new value would
        // tell someone they are hidden when they are not.
        setChoice(previous);
        setError(result.error ?? "Could not save that.");
      }
    });
  }

  return (
    <div className="rounded-md border border-gray-200 p-4">
      {multiple ? (
        <p className="text-sm font-semibold text-gray-900">{row.orgName}</p>
      ) : null}
      <p className="text-xs text-gray-500">
        {row.name}
        {row.roleTitle ? `, ${row.roleTitle}` : ""}
      </p>

      {choice === null ? (
        <p className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          You haven&rsquo;t chosen yet. Until you do, you stay on the website as you are now and
          are <strong>left out of the printed directory</strong>.
        </p>
      ) : null}

      <div className="mt-3 space-y-2" role="radiogroup" aria-label={`Visibility for ${row.orgName}`}>
        {DIRECTORY_VISIBILITY_OPTIONS.map((option) => {
          const selected = choice === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => pick(option.value)}
              className={`w-full rounded-md border p-3 text-left transition disabled:opacity-60 ${
                selected
                  ? "border-[#163D6D] bg-[#163D6D]/5 ring-1 ring-[#163D6D]"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 flex-none rounded-full border-2 ${
                    selected ? "border-[#163D6D] bg-[#163D6D]" : "border-gray-300"
                  }`}
                />
                <span className="text-sm font-semibold text-gray-900">{option.label}</span>
              </span>
              <span className="mt-1 block pl-[1.375rem] text-xs text-gray-600">{option.detail}</span>
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {saved && !error ? <p className="mt-2 text-xs text-green-700">Saved.</p> : null}
    </div>
  );
}
