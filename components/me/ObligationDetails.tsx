"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveConferenceObligations } from "@/lib/actions/conference-access";
import type { DataObligation } from "@/lib/conference/grants";

/**
 * The details the organisers need from this person, as fields they can fill.
 *
 * This section renders exactly the obligations they actually owe — derived
 * from the seats allocated to them, not a fixed form. Someone holding only a
 * badge seat owes nothing and sees nothing; someone with an offsite seat owes
 * an emergency contact because that event needs one. Asking everybody for
 * everything is how a form teaches people to skip it.
 *
 * Replaces a read-only "Missing: Dietary restrictions" bullet. The obligation
 * was computed correctly and displayed honestly, and there was no input for it
 * anywhere in the app, so the only thing a reader could do about it was
 * nothing.
 */
export default function ObligationDetails({
  personId,
  conferenceId,
  obligations,
  values,
}: {
  personId: string;
  conferenceId: string;
  obligations: DataObligation[];
  values: Record<string, string | null>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(obligations.map((o) => [o.key, values[o.key] ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (obligations.length === 0) return null;

  const dirty = obligations.some((o) => draft[o.key] !== (values[o.key] ?? ""));

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveConferenceObligations(personId, conferenceId, draft);
      if (result.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Your details for the organisers</h2>
      <p className="mt-0.5 text-sm text-gray-500">
        We ask for these because of what you&rsquo;re booked into. They go to catering and
        the on-site team, not into the printed directory.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {obligations.map((o) => (
          <label key={o.key} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-900">{o.label}</span>
            <input
              value={draft[o.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [o.key]: e.target.value }))}
              placeholder={PLACEHOLDERS[o.key] ?? ""}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !dirty ? <span className="text-xs font-medium text-green-700">Saved</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </section>
  );
}

/**
 * Concrete examples, because "Dietary restrictions" alone gets answered "none"
 * by people who do in fact need a gluten-free plate. Named per key rather than
 * carried on DataObligation: the obligation is a fact about what someone owes,
 * this is a fact about how to ask, and only one of the two is worth a schema.
 */
const PLACEHOLDERS: Record<string, string> = {
  dietary_restrictions: "Vegetarian, celiac, nut allergy…",
  accessibility_needs: "Step-free access, seating near the front…",
  emergency_contact_name: "Who we call if something happens",
  emergency_contact_phone: "Mobile is best",
};
