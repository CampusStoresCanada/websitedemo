"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOfferToCart } from "@/lib/actions/conference-commerce";
import { addConferenceAttendee, allocateSeat } from "@/lib/actions/conference-entity-commerce";
import type { AssignableEntityColumn } from "@/app/org/[slug]/page";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import type { VisibleContact } from "@/lib/visibility/data";
import AccessSummaryList from "./AccessSummaryList";
import PersonPickerModal from "@/components/people/PersonPickerModal";

/**
 * Storefront tile for an offer the org already holds ≥1 purchased seat of —
 * same visual shell as OfferCard, but aware of holdings. Shows current
 * assigned/open counts and, when an open (purchased-but-unassigned) seat
 * exists, assigns it via the same allocateSeat() path the roster's own
 * "buy 1 more" checkbox flow already uses — no new purchase — rather than
 * always buying another unit. Only once every held seat is assigned does
 * the button fall back to a real purchase, identical to OfferCard's.
 *
 * Deliberately a separate component from OfferCard rather than optional
 * props bolted on: OfferCard is also used by the standalone public
 * conference storefront (offers-client.tsx), which has no seat/holdings
 * context at all — keeping that caller's behavior untouched mattered more
 * than sharing one branchy component.
 */
export default function HeldOfferCard({
  offer,
  entity,
  conferenceId,
  organizationId,
  contacts,
}: {
  offer: ConferenceOffer;
  entity: AssignableEntityColumn;
  conferenceId: string;
  organizationId: string;
  contacts: VisibleContact[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const [isPending, startTransition] = useTransition();

  const freeSeat = entity.seats.find((s) => !s.holderPersonId) ?? null;
  const assignedCount = entity.seats.length - entity.seats.filter((s) => !s.holderPersonId).length;

  const people = contacts.map((c) => ({
    id: c.id,
    name: (c.name as string | undefined) ?? "",
    email: ((c.work_email ?? c.email) as string | undefined) ?? null,
  }));

  const assignTo = (person: { name: string; email: string | null }) => {
    setPicking(false);
    if (!freeSeat) return;
    setFeedback(null);
    startTransition(async () => {
      const added = await addConferenceAttendee(conferenceId, organizationId, {
        displayName: person.name,
        contactEmail: person.email,
      });
      if (!added.success) {
        setFeedback({ text: added.error, ok: false });
        return;
      }
      const result = await allocateSeat(freeSeat.id, added.data.id);
      if (!result.success) {
        setFeedback({ text: result.error, ok: false });
        return;
      }
      setFeedback({ text: result.data.warning ?? `Assigned to ${person.name}.`, ok: true });
      router.refresh();
    });
  };

  const buy = () => {
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
          ? { text: "Added to cart — assign who it's for in the cart.", ok: true }
          : { text: res.error, ok: false }
      );
    });
  };

  const buyDisabled = isPending || !offer.eligible || offer.soldOut;

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      {picking ? (
        <PersonPickerModal
          title={`Who gets this ${offer.name}?`}
          people={people}
          organizationId={organizationId}
          onSelect={assignTo}
          onClose={() => setPicking(false)}
        />
      ) : null}

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

      <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        {entity.seats.length} purchased — {assignedCount} assigned, {entity.seats.length - assignedCount} open
      </div>

      <AccessSummaryList access={offer.accessSummary} />

      <div className="mt-auto pt-4">
        {!offer.eligible ? <p className="text-xs text-amber-700">{offer.ineligibleReason}</p> : null}
        {feedback ? (
          <p className={`mb-2 text-xs ${feedback.ok ? "text-green-700" : "text-red-600"}`}>{feedback.text}</p>
        ) : null}
        {freeSeat ? (
          <button
            onClick={() => setPicking(true)}
            disabled={isPending}
            className="w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Assigning…" : "Assign"}
          </button>
        ) : (
          <button
            onClick={buy}
            disabled={buyDisabled}
            className="w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Adding…" : offer.soldOut ? "Sold out" : "Add 1 more to cart"}
          </button>
        )}
      </div>
    </div>
  );
}
