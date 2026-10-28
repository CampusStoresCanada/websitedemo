"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBursaryAnswer, submitBursaryRequest, type BursaryRequestView } from "@/lib/actions/conference-bursary";
import {
  BURSARY_PAYMENT_LABELS,
  BURSARY_PAYMENT_PREFERENCES,
  GM_BUYER_RULE,
  bursaryRequestGaps,
  type BursaryRequestAnswers,
  type BursaryRequestField,
} from "@/lib/conference/bursary-request";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import AgreeToDocument from "@/components/me/AgreeToDocument";

/**
 * The request itself. Each answer saves as it is given, the way the
 * benchmarking survey does, so a colleague who opens it next sees where it is.
 * Submitting needs every question answered and the terms agreed to.
 */
export default function BursaryRequestForm({
  conferenceId,
  organizationId,
  view,
}: {
  conferenceId: string;
  organizationId: string;
  view: BursaryRequestView;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<BursaryRequestAnswers>(view.answers);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deadline = formatDeadline(view.closesAt);
  const locked = !view.canEdit;
  const gaps = bursaryRequestGaps(answers, view.termsAccepted);

  const save = (field: BursaryRequestField, value: string | boolean | null) => {
    const previous = answers;
    setAnswers({ ...answers, [field]: value } as BursaryRequestAnswers);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveBursaryAnswer({ conferenceId, organizationId, field, value });
      if (!result.success) {
        setAnswers(previous);
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitBursaryRequest({ conferenceId, organizationId });
      if (!result.success) setError(result.error);
      else router.refresh();
    });
  };

  if (view.submittedAt) {
    const delegate = view.contacts.find((c) => c.id === answers.delegate_contact_id);
    return (
      <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <p className="font-semibold">Your request is in.</p>
        <p className="mt-1">
          For {delegate?.name ?? "your delegate"}:{" "}
          {[answers.covers_hotel && "hotel", answers.covers_travel && "travel"].filter(Boolean).join(" and ")}.{" "}
          {answers.payment_preference ? BURSARY_PAYMENT_LABELS[answers.payment_preference] : ""}.
        </p>
        <p className="mt-1">Campus Stores Canada will be in touch about the amount.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6 text-sm text-gray-800">
      <p className="text-gray-600">
        Every member institution can ask for help with hotel nights, travel, or both, for one delegate.
        {deadline && <> Requests close at the end of {deadline}.</>}
      </p>
      {!view.open && <p className="font-medium text-red-700">Requests have closed.</p>}

      <fieldset disabled={locked || isPending} className="space-y-6">
        <section>
          <label className="block font-medium text-gray-900" htmlFor="bursary-delegate">
            Who is the support for?
          </label>
          <select
            id="bursary-delegate"
            value={answers.delegate_contact_id ?? ""}
            onChange={(e) => save("delegate_contact_id", e.target.value || null)}
            className="mt-1 w-full max-w-md rounded-md border border-gray-300 px-2 py-1.5"
          >
            <option value="">Choose a person</option>
            {view.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.roleTitle ? `, ${c.roleTitle}` : ""}
              </option>
            ))}
          </select>
        </section>

        <section>
          <p className="font-medium text-gray-900">What do you need covered?</p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={answers.covers_hotel === true} onChange={(e) => save("covers_hotel", e.target.checked)} />
            Hotel nights
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={answers.covers_travel === true} onChange={(e) => save("covers_travel", e.target.checked)} />
            Travel (economy airfare, or mileage)
          </label>
        </section>

        <section>
          <p className="font-medium text-gray-900">How would you like to be paid?</p>
          {BURSARY_PAYMENT_PREFERENCES.map((p) => (
            <label key={p} className="mt-1 flex items-center gap-2">
              <input
                type="radio"
                name="bursary-payment"
                checked={answers.payment_preference === p}
                onChange={() => save("payment_preference", p)}
              />
              {BURSARY_PAYMENT_LABELS[p]}
            </label>
          ))}
        </section>

        <section>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={answers.gm_buyer_confirmed === true}
              onChange={(e) => save("gm_buyer_confirmed", e.target.checked)}
            />
            <span>This delegate is {GM_BUYER_RULE}.</span>
          </label>
        </section>
      </fieldset>

      <section>
        {view.termsAccepted ? (
          <p className="text-green-700">You&apos;ve agreed to the Travel Bursary Terms.</p>
        ) : view.terms ? (
          !locked && (
            <AgreeToDocument versionId={view.terms.versionId} title={view.terms.title} content={view.terms.content} />
          )
        ) : (
          <p className="text-gray-500">The Travel Bursary Terms aren&apos;t published yet.</p>
        )}
      </section>

      {error && <p className="text-red-700">{error}</p>}
      {saved && !error && <p className="text-gray-500">Saved.</p>}

      {!locked && (
        <div>
          {gaps.length > 0 && (
            <ul className="mb-2 list-disc pl-5 text-gray-600">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={gaps.length > 0 || isPending}
            className="rounded-md bg-[#163D6D] px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Submit request
          </button>
        </div>
      )}
    </div>
  );
}
