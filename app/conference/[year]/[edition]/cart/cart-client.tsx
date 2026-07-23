"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearCart,
  createConferenceCheckout,
  devCompleteConferenceCheckout,
  getConferenceCart,
  removeCartItem,
  setCartItemAttendee,
  updateCartItemQuantity,
} from "@/lib/actions/conference-commerce";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import PersonPickerModal, { type PickablePerson } from "@/components/people/PersonPickerModal";

type AttendeeRef = { name: string; email: string | null };
type OfferItem = {
  cartItemId: string;
  offerEntityId: string;
  name: string;
  kind: string;
  quantity: number;
  unitPriceCents: number;
  linkedToCartItemIds: string[];
  attendees: (AttendeeRef | null)[];
};
type CartWithTotals = {
  offerItems: OfferItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};
/** Narrowed OrgEntitySeat (lib/actions/conference-entity-commerce.ts) — only the fields the open-seat nudge needs. */
type OrgSeat = { entityId: string; holderPersonId: string | null };

export default function CartClient({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  organizationName,
  orgSlug,
  isDevAdmin,
  initialCart,
  contacts,
  orgSeats,
}: {
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
  organizationId: string;
  organizationName: string;
  orgSlug: string;
  isDevAdmin: boolean;
  initialCart: CartWithTotals;
  /** The org's existing Store Contacts — the picker's default list when assigning a registration line. */
  contacts: PickablePerson[];
  /** The org's already-purchased seats across all entities — empty for viewers below org_admin (listEntitySeatsForOrg's own guard), which just means the open-seat nudge below stays silent for them. */
  orgSeats: OrgSeat[];
}) {
  const router = useRouter();
  const [cart, setCart] = useState<CartWithTotals>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assigningSlot, setAssigningSlot] = useState<{ cartItemId: string; index: number } | null>(null);

  const isEmpty = cart.offerItems.length === 0;
  const checkoutDisabled = isPending || isEmpty;
  const boothCount = cart.offerItems.filter((item) => item.kind === "booth").length;

  // Registration items in the cart that the org already holds an unassigned
  // (purchased-but-open) seat of — a nudge to assign what's already paid
  // for instead of buying another unit, mirroring the org page's
  // HeldOfferCard logic but surfaced at the point of checkout, since a cart
  // line added from the public (non-holdings-aware) storefront wouldn't
  // otherwise show this.
  const openSeatOfferNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of cart.offerItems) {
      if (item.kind !== "registration") continue;
      const hasOpenSeat = orgSeats.some((seat) => seat.entityId === item.offerEntityId && !seat.holderPersonId);
      if (hasOpenSeat) names.add(item.name);
    }
    return Array.from(names);
  }, [cart.offerItems, orgSeats]);

  const lineTotals = useMemo(() => {
    const byItemId = new Map<string, number>();
    for (const item of cart.offerItems) {
      byItemId.set(item.cartItemId, item.quantity * item.unitPriceCents);
    }
    return byItemId;
  }, [cart.offerItems]);

  const refreshCart = async () => {
    const refreshed = await getConferenceCart(conferenceId, organizationId);
    if (!refreshed.success) {
      setError(refreshed.error);
      return false;
    }
    setCart(refreshed.data);
    return true;
  };

  const handleSetAttendee = (attendee: AttendeeRef | null) => {
    if (!assigningSlot) return;
    const { cartItemId, index } = assigningSlot;
    setAssigningSlot(null);
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await setCartItemAttendee({ cartItemId, index, attendee });
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.data.warning) setWarning(result.data.warning);
      await refreshCart();
    });
  };

  const handleRemove = (cartItemId: string) => {
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const result = await removeCartItem(cartItemId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      await refreshCart();
      dispatchConferenceCartUpdated(organizationId);
    });
  };

  const handleUpdateQuantity = (cartItemId: string, quantity: number) => {
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const result = await updateCartItemQuantity({ cartItemId, quantity });
      if (!result.success) {
        setError(result.error);
        return;
      }
      await refreshCart();
      dispatchConferenceCartUpdated(organizationId);
    });
  };

  const handleClear = () => {
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const result = await clearCart({ conferenceId, organizationId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      await refreshCart();
      dispatchConferenceCartUpdated(organizationId);
      setStatus("Cart cleared.");
    });
  };

  const handleCheckout = () => {
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const origin = window.location.origin;
      const successUrl = `${origin}/conference/${conferenceYear}/${conferenceEdition}/checkout/success?org=${organizationId}`;
      const cancelUrl = `${origin}/conference/${conferenceYear}/${conferenceEdition}/checkout/cancel?org=${organizationId}`;

      const result = await createConferenceCheckout({
        conferenceId,
        organizationId,
        successUrl,
        cancelUrl,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      window.location.assign(result.data.checkoutUrl);
    });
  };

  // Dev-only: complete the purchase without Stripe (global admins). Runs the same
  // RPCs the live webhook does, so seats mint and the buy→allocate loop is testable.
  const handleDevComplete = () => {
    setError(null);
    setStatus(null);
    setCompletedOrderId(null);

    startTransition(async () => {
      const result = await devCompleteConferenceCheckout({ conferenceId, organizationId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      await refreshCart();
      dispatchConferenceCartUpdated(organizationId);
      setCompletedOrderId(result.data.orderId);
      setStatus("Purchase completed (dev). Seats minted.");
    });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Cart for <strong>{organizationName}</strong>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {status ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{status}</p>
      ) : null}
      {warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>
      ) : null}
      {completedOrderId ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Seats are ready to assign.{" "}
          <Link href={`/org/${orgSlug}`} className="font-semibold underline">
            Go to {organizationName}&apos;s profile to assign them →
          </Link>
        </div>
      ) : null}

      {boothCount >= 2 ? (
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          You have {boothCount} booths in this cart. Extra booths add floor space — they don&apos;t add
          meeting slots or extend meeting length; those come from your registration, not booth count.
        </p>
      ) : null}

      {openSeatOfferNames.length > 0 ? (
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Looks like your org already has an open, unassigned {openSeatOfferNames.join(", ")} seat — you
          may want to check with your org admin and assign it before buying another.{" "}
          <Link href={`/org/${orgSlug}`} className="font-semibold underline">
            Go to {organizationName}&apos;s profile →
          </Link>
        </p>
      ) : null}

      {isEmpty ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Your cart is empty</h2>
          <p className="mt-2 text-sm text-gray-600">Add offers from the conference catalog.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Unit</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Line total</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {cart.offerItems.map((item) => {
                const isMembershipRenewal = item.kind === "membership_renewal";
                const isBooth = item.kind === "booth";
                const isRegistration = item.kind === "registration";
                const linkedFrom = isMembershipRenewal
                  ? cart.offerItems.filter((i) => item.linkedToCartItemIds.includes(i.cartItemId))
                  : [];

                return (
                  <tr key={item.cartItemId} className={isMembershipRenewal ? "bg-amber-50/50" : undefined}>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {isMembershipRenewal ? "Membership Renewal" : item.name}
                      </div>
                      {isMembershipRenewal ? (
                        <p className="mt-0.5 text-xs text-amber-700">
                          Required to purchase{" "}
                          {linkedFrom.length > 0 ? linkedFrom.map((i) => i.name).join(", ") : "the linked item"} —
                          extends your membership coverage through this conference&apos;s dates.
                        </p>
                      ) : null}
                      {isRegistration ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Array.from({ length: item.quantity }, (_, index) => {
                            const attendee = item.attendees[index] ?? null;
                            return (
                              <button
                                key={index}
                                onClick={() => setAssigningSlot({ cartItemId: item.cartItemId, index })}
                                disabled={isPending}
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  attendee
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300"
                                    : "border-dashed border-gray-300 text-gray-500 hover:border-gray-400"
                                }`}
                              >
                                {attendee ? attendee.name : `Assign #${index + 1}`}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatCents(item.unitPriceCents)}</td>
                    <td className="px-4 py-3">
                      {isMembershipRenewal || isBooth ? (
                        <span className="text-sm text-gray-500">1</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(event) =>
                            handleUpdateQuantity(item.cartItemId, Math.max(0, Number(event.target.value) || 0))
                          }
                          className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          disabled={isPending}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatCents(lineTotals.get(item.cartItemId) ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      {isMembershipRenewal ? (
                        <span className="text-xs text-gray-500">
                          Remove {linkedFrom.length > 0 ? linkedFrom.map((i) => i.name).join(", ") : "the linked item"} to remove this
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRemove(item.cartItemId)}
                          disabled={isPending}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="space-y-2 text-sm text-gray-700">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span>{formatCents(cart.subtotalCents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Tax</span>
            <span>{formatCents(cart.taxCents)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-base font-semibold text-gray-900">
            <span>Total</span>
            <span>{formatCents(cart.totalCents)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleCheckout}
            disabled={checkoutDisabled}
            className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Processing..." : "Proceed to Checkout"}
          </button>
          <button
            onClick={handleClear}
            disabled={isPending || isEmpty}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Cart
          </button>
          <button
            onClick={() => router.refresh()}
            disabled={isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {isDevAdmin ? (
          <div className="mt-3 border-t border-dashed border-amber-300 pt-3">
            <button
              onClick={handleDevComplete}
              disabled={isPending || isEmpty}
              className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Completing…" : "Complete purchase (dev — skip Stripe)"}
            </button>
            <p className="mt-1 text-[11px] text-amber-700">
              Admin/dev only: marks the order paid via the real mint RPCs so seats appear without Stripe.
            </p>
          </div>
        ) : null}
      </div>

      {assigningSlot ? (
        <PersonPickerModal
          title="Who is this seat for?"
          people={contacts}
          organizationId={organizationId}
          onSelect={(person) => handleSetAttendee(person)}
          onDeferLater={() => handleSetAttendee(null)}
          onClose={() => setAssigningSlot(null)}
        />
      ) : null}
    </section>
  );
}
