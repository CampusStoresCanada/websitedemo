"use client";

import { useState, useTransition } from "react";
import { addOfferToCart } from "@/lib/actions/conference-commerce";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import AccessSummaryList from "./AccessSummaryList";

export default function OfferCard({
  offer,
  conferenceId,
  organizationId,
  compact = false,
}: {
  offer: ConferenceOffer;
  conferenceId: string;
  organizationId: string;
  /** Lighter-weight row treatment for optional add-ons already covered by a
   *  registration (e.g. an extra Meet & Greet ticket for a guest) — so it
   *  doesn't read with the same visual weight as picking a registration tier. */
  compact?: boolean;
}) {
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const add = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await addOfferToCart({
        conferenceId,
        organizationId,
        offerEntityId: offer.id,
        quantity: 1,
      });
      if (res.success) dispatchConferenceCartUpdated(organizationId);
      setFeedback(
        res.success
          ? {
              text: offer.kind === "registration" ? "Added to cart — assign who it's for in the cart." : "Added to cart.",
              ok: true,
            }
          : { text: res.error, ok: false }
      );
    });
  };

  const disabled = isPending || !offer.eligible || offer.soldOut;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">{offer.name}</p>
          <p className="text-xs text-gray-500">Already included with your registration — buy extra for a colleague or guest.</p>
          {!offer.eligible ? <p className="mt-1 text-xs text-amber-700">{offer.ineligibleReason}</p> : null}
          {feedback ? (
            <p className={`mt-1 text-xs ${feedback.ok ? "text-green-700" : "text-red-600"}`}>{feedback.text}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-gray-500">{formatCents(offer.unitPriceCents)}</span>
          <button
            onClick={add}
            disabled={disabled}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Adding…" : offer.soldOut ? "Sold out" : "Add extra"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{offer.kind}</div>
          <h3 className="text-base font-semibold text-gray-900">{offer.name}</h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold text-gray-900">{formatCents(offer.unitPriceCents)}</div>
          <div className="text-[11px] text-gray-500">
            {offer.remaining == null ? "Available" : offer.soldOut ? "Sold out" : `${offer.remaining} left`}
          </div>
        </div>
      </div>

      <AccessSummaryList access={offer.accessSummary} />

      <div className="mt-auto pt-4">
        {!offer.eligible ? <p className="text-xs text-amber-700">{offer.ineligibleReason}</p> : null}
        {feedback ? (
          <p className={`mb-2 text-xs ${feedback.ok ? "text-green-700" : "text-red-600"}`}>{feedback.text}</p>
        ) : null}
        <button
          onClick={add}
          disabled={disabled}
          className="w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Adding…" : offer.soldOut ? "Sold out" : "Add to cart"}
        </button>
      </div>
    </div>
  );
}
