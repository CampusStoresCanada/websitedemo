"use client";

import { useState, useTransition } from "react";
import { addOfferToCart } from "@/lib/actions/conference-commerce";
import { createProspectiveRegistrationCheckout } from "@/lib/actions/prospective-registration-checkout";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import AccessSummaryList from "./AccessSummaryList";

const DAY_ORDER = ["Tuesday", "Wednesday", "Thursday"];

function dayLabel(offerName: string): string {
  // Strips from "Day Pass" onward, not just a literal trailing match — a
  // non-member buyer's set can include a distinct same-day entity like
  // "Thursday Day Pass (Non-Member)" (kept separate because it can't carry
  // the Membership Renewal requirement the member version has), and it
  // should still read as plain "Thursday" here, sorting correctly too.
  return offerName.replace(/\s*Day Pass.*$/i, "");
}

/**
 * The catalog models each day's Day Pass as its own registration entity
 * (each with its own day's meals/sessions in `includes`, and its own
 * eligibility per buyer tier) so ownership and access resolve per-day. To the
 * buyer this is one product with a day picker, not several near-identical
 * products — this component is the UI-only merge; the buy action still
 * targets whichever day is selected. Works the same whether the buyer's
 * eligible set is the full Tue/Wed/Thu member lineup or just the one or two
 * days a non-member can buy.
 *
 * Two real buyers, two real actions — nothing in between:
 *  - A Member/Partner org (`organizationId` set) has an ongoing account and a
 *    roster — buying just adds to their cart; who's actually attending gets
 *    assigned afterward on their org profile's seat panel.
 *  - Everyone else — a stranger who's never had any account, which is the
 *    only way anyone ever ends up as a non-member — has no organizationId
 *    and no cart to add to. There's no "sign in as a non-member org" case in
 *    between; the two payment mechanisms below are the whole story.
 */
export default function DayPassOfferCard({
  offers,
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  legalDocs,
}: {
  offers: ConferenceOffer[];
  conferenceId: string;
  /** Only needed for the pay-first success/cancel redirect — unused when organizationId is set. */
  conferenceYear?: string | number;
  conferenceEdition?: string;
  /** Set only for a real Member/Partner org. Omit entirely for a stranger buying without an account. */
  organizationId?: string;
  /** Required consent documents for the pay-first path — ignored in cart mode (Members/Partners accept these via the existing org-level legal gate). */
  legalDocs?: Array<{ documentType: string; label: string; content: string }>;
}) {
  const isCartMode = Boolean(organizationId);
  const sorted = [...offers].sort(
    (a, b) => DAY_ORDER.indexOf(dayLabel(a.name)) - DAY_ORDER.indexOf(dayLabel(b.name))
  );
  const firstAvailable = sorted.find((o) => o.eligible && !o.soldOut) ?? sorted[0];
  const [selectedId, setSelectedId] = useState(firstAvailable.id);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showDetailsForm, setShowDetailsForm] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState("");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  const selected = sorted.find((o) => o.id === selectedId) ?? sorted[0];
  const allAccepted = (legalDocs ?? []).every((d) => accepted.has(d.documentType));

  const toggleAccepted = (documentType: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(documentType)) next.delete(documentType);
      else next.add(documentType);
      return next;
    });
  };

  const addToCart = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await addOfferToCart({
        conferenceId,
        organizationId: organizationId!,
        offerEntityId: selected.id,
        quantity: 1,
      });
      if (res.success) dispatchConferenceCartUpdated(organizationId);
      setFeedback(
        res.success
          ? { text: "Added to cart — assign who it's for in the cart.", ok: true }
          : { text: res.error, ok: false }
      );
    });
  };

  const submitPayFirst = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAccepted) {
      setFeedback({ text: "Please accept all required documents before continuing.", ok: false });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const baseUrl = window.location.origin;
      const conferencePath = `/conference/${conferenceYear}/${conferenceEdition}`;
      const result = await createProspectiveRegistrationCheckout({
        conferenceId,
        offerEntityId: selected.id,
        organizationName,
        firstName,
        lastName,
        email,
        phone,
        jobTitle,
        dietaryRestrictions,
        acceptedDocumentTypes: [...accepted],
        successUrl: `${baseUrl}${conferencePath}/attend/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}${conferencePath}`,
      });
      if (!result.success) {
        setFeedback({ text: result.error, ok: false });
        return;
      }
      window.location.href = result.data.checkoutUrl;
    });
  };

  const disabled = isPending || !selected.eligible || selected.soldOut;
  const inputClass =
    "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]";

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">registration</div>
          <h3 className="text-base font-semibold text-gray-900">Day Pass</h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold text-gray-900">{formatCents(selected.unitPriceCents)}</div>
          <div className="text-[11px] text-gray-500">
            {selected.remaining == null ? "Available" : selected.soldOut ? "Sold out" : `${selected.remaining} left`}
          </div>
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-gray-600">
        Which day are you coming?
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        >
          {sorted.map((o) => (
            <option key={o.id} value={o.id} disabled={o.soldOut}>
              {dayLabel(o.name)}
              {o.soldOut ? " — sold out" : ""}
            </option>
          ))}
        </select>
      </label>

      <AccessSummaryList access={selected.accessSummary} />

      <div className="mt-auto pt-4">
        {!selected.eligible ? <p className="text-xs text-amber-700">{selected.ineligibleReason}</p> : null}
        {feedback ? (
          <p className={`mb-2 text-xs ${feedback.ok ? "text-green-700" : "text-red-600"}`}>{feedback.text}</p>
        ) : null}

        {isCartMode ? (
          <button
            onClick={addToCart}
            disabled={disabled}
            className="w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Adding…" : selected.soldOut ? "Sold out" : "Add to cart"}
          </button>
        ) : showDetailsForm ? (
          <form onSubmit={submitPayFirst} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-medium text-gray-600">Your details</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                required
                className={inputClass}
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                required
                className={inputClass}
              />
            </div>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Your school or store name"
              required
              className={inputClass}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2">
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title" className={inputClass} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" className={inputClass} />
            </div>
            <input
              value={dietaryRestrictions}
              onChange={(e) => setDietaryRestrictions(e.target.value)}
              placeholder="Dietary restrictions (optional)"
              className={inputClass}
            />

            {(legalDocs ?? []).length > 0 ? (
              <div className="space-y-1.5 rounded-md border border-gray-200 bg-white p-2">
                {(legalDocs ?? []).map((doc) => (
                  <div key={doc.documentType}>
                    <label className="flex items-start gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={accepted.has(doc.documentType)}
                        onChange={() => toggleAccepted(doc.documentType)}
                        className="mt-0.5"
                      />
                      <span>
                        I accept the{" "}
                        <button
                          type="button"
                          onClick={() => setExpandedDoc(expandedDoc === doc.documentType ? null : doc.documentType)}
                          className="font-medium text-[#EE2A2E] underline"
                        >
                          {doc.label}
                        </button>
                      </span>
                    </label>
                    {expandedDoc === doc.documentType ? (
                      <div
                        className="mt-1 max-h-32 overflow-y-auto rounded-md border border-gray-100 bg-gray-50 p-2 text-[11px] text-gray-600"
                        dangerouslySetInnerHTML={{ __html: doc.content }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDetailsForm(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !allAccepted}
                className="flex-1 rounded-md bg-[#EE2A2E] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Starting checkout…" : "Continue to payment"}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowDetailsForm(true)}
            disabled={disabled}
            className="w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selected.soldOut ? "Sold out" : `Continue with ${dayLabel(selected.name)} — ${formatCents(selected.unitPriceCents)}`}
          </button>
        )}
      </div>
    </div>
  );
}
