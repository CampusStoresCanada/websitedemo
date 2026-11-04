"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBursaryAnswer, submitBursaryRequest, type BursaryRequestView } from "@/lib/actions/conference-bursary";
import {
  BURSARY_NOTES_MAX,
  BURSARY_PAYMENT_LABELS,
  BURSARY_PAYMENT_PREFERENCES,
  GM_BUYER_RULE,
  bursaryRequestGaps,
  type BursaryRequestAnswers,
  type BursaryRequestField,
} from "@/lib/conference/bursary-request";
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
  registerHref,
}: {
  conferenceId: string;
  organizationId: string;
  view: BursaryRequestView;
  /** Where the school registers, for when it has no registration to pick yet. */
  registerHref: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<BursaryRequestAnswers>(view.answers);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deadline = view.closesOnLabel;
  const locked = !view.canEdit;
  const gaps = bursaryRequestGaps(answers, view.termsAccepted);

  /*
    Saves go one after another, never in parallel, and the questions stay
    usable while they do. Disabling the form during each save swallowed a
    second click made before the first save returned; running saves in
    parallel let the first two both try to create the school's row.
  */
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const save = (field: BursaryRequestField, value: string | boolean | null) => {
    const before = answers[field];
    setAnswers((current) => ({ ...current, [field]: value }) as BursaryRequestAnswers);
    setError(null);
    setSaved(false);
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await saveBursaryAnswer({ conferenceId, organizationId, field, value });
      if (!result.success) {
        setAnswers((current) => ({ ...current, [field]: before }) as BursaryRequestAnswers);
        setError(result.error);
      } else {
        setSaved(true);
        // A different registration is a different delegate: the summary above
        // names them from the server, so read it again.
        if (field === "delegate_seat_id" && view.submittedAt) router.refresh();
      }
    });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      await saveQueue.current;
      const result = await submitBursaryRequest({ conferenceId, organizationId });
      if (!result.success) setError(result.error);
      else router.refresh();
    });
  };

  /*
    Who it is for: one of the school's registrations. The holder of that seat is
    the delegate, so naming someone else to the registration on the
    institution's page moves the support with it. Open after submitting too,
    until the designation deadline.
  */
  const designation = (
    <section>
      <label className="block font-medium text-gray-900" htmlFor="bursary-delegate">
        Who is the support for?
      </label>
      {view.seats.length === 0 ? (
        <p className="mt-1 text-gray-600">
          Pick one of your institution&apos;s conference registrations. You don&apos;t have one yet.{" "}
          <a href={registerHref} className="font-medium text-[#163D6D] underline">
            Register for the conference
          </a>
          , then come back here. You can send your request now and choose the registration later.
        </p>
      ) : (
        <>
          <select
            id="bursary-delegate"
            value={answers.delegate_seat_id ?? ""}
            disabled={!view.canDesignate}
            onChange={(e) => save("delegate_seat_id", e.target.value || null)}
            className="mt-1 w-full max-w-md rounded-md border border-gray-300 px-2 py-1.5"
          >
            <option value="">Choose a registration</option>
            {view.seats.map((seat) => (
              <option key={seat.seatId} value={seat.seatId}>
                {seat.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-gray-600">
            The support goes with the registration. To send someone else, name them to it on your
            institution&apos;s page
            {view.designationClosesOnLabel && <>, or pick a different registration here, until the end of {view.designationClosesOnLabel}</>}.
          </p>
        </>
      )}
    </section>
  );

  if (view.submittedAt) {
    return (
      <div className="mt-6 space-y-4 text-sm">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
          <p className="font-semibold">Your request is in.</p>
          <p className="mt-1">
            For {view.delegateName ?? "a registration you haven't picked yet"}:{" "}
            {[answers.covers_hotel && "hotel", answers.covers_travel && "travel"].filter(Boolean).join(" and ")}.{" "}
            {answers.payment_preference ? BURSARY_PAYMENT_LABELS[answers.payment_preference] : ""}.
          </p>
          {answers.covers_hotel && <p className="mt-1">Hotel: {view.hotelText}.</p>}
          {answers.notes && <p className="mt-1">You also told us: {answers.notes}</p>}
          <p className="mt-1">
            There is no separate approval to wait for. After the conference, claim your expenses on this page, with
            receipts.
          </p>
        {/* The terms changed after this request went in (v2, 2026-11-02): the
            school agrees to the current version here, by the same control. */}
        {!view.termsAccepted && view.terms && (
          <div className="mt-4 text-gray-800">
            <p className="mb-2 font-medium">The Travel Bursary Terms have been updated. Please read and agree to them.</p>
            <AgreeToDocument versionId={view.terms.versionId} title={view.terms.title} content={view.terms.content} />
          </div>
        )}
        </div>
        <div className="text-gray-800">{designation}</div>
        {error && <p className="text-red-700">{error}</p>}
        {saved && !error && <p className="text-gray-500">Saved.</p>}
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

      <fieldset disabled={locked} className="space-y-6">
        {designation}

        <section>
          <p className="font-medium text-gray-900">What do you need covered?</p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={answers.covers_hotel === true} onChange={(e) => save("covers_hotel", e.target.checked)} />
            Hotel nights ({view.hotelText})
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={answers.covers_travel === true} onChange={(e) => save("covers_travel", e.target.checked)} />
            Travel (economy airfare, train, or mileage)
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

        <section>
          <label className="block font-medium text-gray-900" htmlFor="bursary-notes">
            I need additional help <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <p className="mt-0.5 text-gray-600">
            If cost is still a barrier after this support, tell us what you need. The board looks at each request
            and can&apos;t promise to meet every one.
          </p>
          <textarea
            id="bursary-notes"
            rows={3}
            maxLength={BURSARY_NOTES_MAX}
            defaultValue={answers.notes ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== answers.notes) save("notes", next);
            }}
            className="mt-1 w-full max-w-xl rounded-md border border-gray-300 px-2 py-1.5"
          />
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
