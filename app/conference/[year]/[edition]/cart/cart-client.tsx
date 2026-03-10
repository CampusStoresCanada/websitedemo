"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearCart,
  createConferenceCheckout,
  getConferenceCart,
  removeCartItem,
  updateCartItemQuantity,
} from "@/lib/actions/conference-commerce";
import { formatCents } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CartRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProductRow = Record<string, any>;
type CartWithTotals = {
  items: Array<CartRow & { product: ProductRow }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export default function CartClient({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  organizationName,
  initialCart,
}: {
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
  organizationId: string;
  organizationName: string;
  initialCart: CartWithTotals;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<CartWithTotals>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEmpty = cart.items.length === 0;
  const checkoutDisabled = isPending || isEmpty;

  const lineTotals = useMemo(() => {
    const byItemId = new Map<string, number>();
    for (const item of cart.items) {
      byItemId.set(item.id, item.quantity * item.product.price_cents);
    }
    return byItemId;
  }, [cart.items]);

  const refreshCart = async () => {
    const refreshed = await getConferenceCart(conferenceId, organizationId);
    if (!refreshed.success) {
      setError(refreshed.error);
      return false;
    }
    setCart(refreshed.data);
    return true;
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

      {isEmpty ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Your cart is empty</h2>
          <p className="mt-2 text-sm text-gray-600">Add products from the conference catalog.</p>
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
              {cart.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{item.product.name}</div>
                    <div className="text-xs text-gray-500">{item.product.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatCents(item.product.price_cents)}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(event) =>
                        handleUpdateQuantity(item.id, Math.max(0, Number(event.target.value) || 0))
                      }
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      disabled={isPending}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {formatCents(lineTotals.get(item.id) ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRemove(item.id)}
                      disabled={isPending}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
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
            className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>
    </section>
  );
}
