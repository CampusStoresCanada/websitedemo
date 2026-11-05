"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestOpenRegistrationRefund,
  saveBursaryAnswer,
  setBursaryRecipient,
  submitBursaryRequest,
  type BursaryRequestView,
} from "@/lib/actions/conference-bursary";
import {
  BURSARY_NOTES_MAX,
  BURSARY_PAYMENT_LABELS,
  BURSARY_PREPAY_CONTACT,
  GM_BUYER_RULE,
  bursaryRequestGaps,
  type BursaryRequestAnswers,
  type BursaryRequestField,
} from "@/lib/conference/bursary-request";
import ContactEditModal from "@/components/org/ContactEditModal";
import Modal from "@/components/ui/Modal";

/**
 * The request itself. Each answer saves as it is given, the way the
 * benchmarking survey does, so a colleague who opens it next sees where it is.
 * Submitting needs every question answered.
 *
 * Whoever fills it in makes the choices and can read the terms; only the
 * person taking the bursary agrees to them, on their own conference page
 * (Steve, 2026-11-05).
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
  const gaps = bursaryRequestGaps(answers);
  const [refundAsked, setRefundAsked] = useState<Set<string>>(new Set());

  const [addingPerson, setAddingPerson] = useState(false);

  /* Someone else holds the CANCOLL-covered registration: say who loses it, in
     the site's modal, before anything moves. */
  const [replacing, setReplacing] = useState<{ contactId: string; chosen: string; current: string } | null>(null);
  const pendingName = useRef<string | null>(null);

  const nameRecipient = (contactId: string, replace: boolean) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      await saveQueue.current;
      const result = await setBursaryRecipient({ conferenceId, organizationId, contactId, replace });
      if (!result.success) return setError(result.error);
      if (result.data.confirmReplacing) {
        const chosen = view.people.find((p) => p.contactId === contactId)?.name ?? pendingName.current ?? "this person";
        setReplacing({ contactId, chosen, current: result.data.confirmReplacing });
        return;
      }
      setReplacing(null);
      setSaved(true);
      router.refresh();
    });
  };

  const chooseRecipient = (contactId: string, newName?: string) => {
    if (!contactId) return;
    pendingName.current = newName ?? null;
    nameRecipient(contactId, false);
  };

  const askRefund = (seatId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await requestOpenRegistrationRefund({ conferenceId, organizationId, seatId });
      if (!result.success) return setError(result.error);
      setRefundAsked((current) => new Set(current).add(seatId));
    });
  };

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
    Who it is for: a person. For a school with a CANCOLL-funded registration,
    choosing them names them to it (setBursaryRecipient), so the free
    registration, CANCOLL's lists and the support are the same person. Open
    after submitting too, until the designation deadline.
  */
  const orgHref = view.orgSlug ? `/org/${view.orgSlug}#conference_checklist` : null;
  const recipient = view.recipient;
  const designation = (
    <section className="space-y-2">
      <label className="block font-medium text-gray-900" htmlFor="bursary-delegate">
        Who is getting the support?
      </label>
      {view.people.length === 0 ? (
        <p className="text-gray-600">
          Your institution has no contacts on its page yet.{" "}
          {view.canDesignate && (
            <button type="button" onClick={() => setAddingPerson(true)} className="font-medium text-[#163D6D] underline">
              Add the person
            </button>
          )}
          {" "}or{" "}
          <a href={registerHref} className="font-medium text-[#163D6D] underline">
            register for the conference
          </a>
          . You can send your request now and choose the person later.
        </p>
      ) : (
        <>
          <select
            id="bursary-delegate"
            value={recipient?.contactId ?? ""}
            disabled={!view.canDesignate || isPending}
            onChange={(e) => chooseRecipient(e.target.value)}
            className="w-full max-w-md rounded-md border border-gray-300 px-2 py-1.5"
          >
            <option value="">Choose a person</option>
            {view.people.map((p) => (
              <option key={p.contactId} value={p.contactId}>
                {p.name}
                {p.holds.length > 0 ? `, ${p.holds.join(", ")}` : ", not registered"}
              </option>
            ))}
          </select>
          {view.canDesignate && (
            <button
              type="button"
              onClick={() => setAddingPerson(true)}
              disabled={isPending}
              className="block text-left font-medium text-[#163D6D] underline disabled:opacity-50"
            >
              Add someone who isn&apos;t listed
            </button>
          )}
          {isPending && <p className="text-gray-500">Updating who the support is for…</p>}
          <p className="text-gray-600">
            {view.hasFundedRegistration
              ? "The person you choose is named to your CANCOLL-covered registration, so the free registration and the travel support go to the same person."
              : "The support goes with the registration the person you choose holds."}
            {view.designationClosesOnLabel && <> You can change this until the end of {view.designationClosesOnLabel}.</>}
          </p>
        </>
      )}
      {recipient?.name && (
        <p className={recipient.agreed ? "text-green-700" : "text-amber-800"}>
          {recipient.agreed
            ? `${recipient.name} has agreed to the Travel Bursary Terms.`
            : `${recipient.name} needs to agree to the Travel Bursary Terms on their own conference page. We've asked them to. Only the person taking the bursary can agree.`}
        </p>
      )}
      {/* The org page's own "Add contact" form (as PersonPickerModal reuses it):
          a new contact, then named straight to the support. */}
      {addingPerson && (
        <ContactEditModal
          contact={null}
          organizationId={organizationId}
          onClose={() => setAddingPerson(false)}
          onCreated={(created) => {
            setAddingPerson(false);
            chooseRecipient(created.id, created.name);
          }}
        />
      )}
      <Modal
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title="Change who holds your CANCOLL registration?"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReplacing(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => replacing && nameRecipient(replacing.contactId, true)}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isPending ? "Updating…" : `Name ${replacing?.chosen ?? ""}`}
            </button>
          </div>
        }
      >
        {replacing && (
          <div className="space-y-2 px-5 py-4 text-sm text-gray-800">
            <p>
              {replacing.current} holds your CANCOLL-covered registration now. Naming {replacing.chosen} moves it to them,
              with the travel support.
            </p>
            <p>
              {replacing.current} will no longer have that registration. If they&apos;re still coming, register them
              separately.
            </p>
          </div>
        )}
      </Modal>
      {view.openRegistrations.map((open) => (
        <div key={open.seatId} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">You have an open {open.entityName} that nobody holds.</p>
          {refundAsked.has(open.seatId) ? (
            <p className="mt-1">We&apos;ve asked Campus Stores Canada to refund it. They&apos;ll be in touch.</p>
          ) : (
            <>
              <p className="mt-1">
                <span className="font-medium">To give it to someone else:</span> open your institution&apos;s page, open the
                toolkit (the round + button, bottom right) and choose Edit. Then, in your people list, tick the person under{" "}
                {open.entityName}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {orgHref && (
                  <a href={orgHref} className="rounded-md bg-[#163D6D] px-3 py-1.5 font-semibold text-white">
                    Reassign it
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => askRefund(open.seatId)}
                  disabled={isPending}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium disabled:opacity-50"
                >
                  Ask for a refund
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );

  const termsPanel = view.terms ? (
    <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <summary className="cursor-pointer font-medium text-gray-900">
        What the Travel Bursary covers (the full terms)
      </summary>
      <div
        className="prose prose-sm mt-2 max-w-none text-sm text-gray-700"
        dangerouslySetInnerHTML={{ __html: view.terms.content }}
      />
    </details>
  ) : null;

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
            There is no separate approval to wait for. After the conference, you&apos;ll claim your expenses, with
            receipts, on a separate page.
          </p>
        </div>
        <div className="text-gray-800">{designation}</div>
        {termsPanel}
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
          <p className="font-medium text-gray-900">Payment</p>
          <p className="mt-1">
            We reimburse your expenses after the conference. If paying up front is a problem for your institution,
            email <a href={`mailto:${BURSARY_PREPAY_CONTACT}`} className="underline">{BURSARY_PREPAY_CONTACT}</a> and
            we may be able to help.
          </p>
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

      {termsPanel}

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
