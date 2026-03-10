"use client";

import { useMemo, useState, useTransition } from "react";
import { addCartItem } from "@/lib/actions/conference-commerce";
import { formatCents } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProductWithEligibility = Record<string, any> & {
  eligibilityErrors: string[];
};

function buildMeetingTimeMetadata(params: {
  quantity: number;
  brandName: string;
  primaryBrandIndex: number;
  multiBrandInput: string;
}): Record<string, unknown> {
  if (params.quantity <= 1) {
    return {
      brand_name: params.brandName.trim(),
      is_primary_brand: true,
    };
  }

  const brands = params.multiBrandInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    brands: brands.map((brandName, index) => ({
      brand_name: brandName,
      is_primary_brand: index === params.primaryBrandIndex,
    })),
  };
}

export default function ProductsClient({
  conferenceId,
  selectedOrganizationId,
  selectedOrganizationType,
  isVendorPartner,
  products,
}: {
  conferenceId: string;
  selectedOrganizationId: string;
  selectedOrganizationType: string | null;
  isVendorPartner: boolean;
  products: ProductWithEligibility[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [meetingBrandName, setMeetingBrandName] = useState("");
  const [multiBrandInput, setMultiBrandInput] = useState("");
  const [primaryBrandIndex, setPrimaryBrandIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const partnerMeetingProduct = useMemo(
    () => products.find((product) => product.slug === "partner_meeting_time"),
    [products]
  );

  const handleAddToCart = (product: ProductWithEligibility) => {
    setStatus(null);
    setError(null);

    const quantity = Math.max(1, quantities[product.id] ?? 1);
    const isMeetingTime = product.slug === "partner_meeting_time";
    const metadata = isMeetingTime
      ? buildMeetingTimeMetadata({
          quantity,
          brandName: meetingBrandName,
          multiBrandInput,
          primaryBrandIndex,
        })
      : null;

    if (isMeetingTime && quantity <= 1 && !meetingBrandName.trim()) {
      setError("Partner meeting time requires a brand name.");
      return;
    }

    if (isMeetingTime && quantity > 1) {
      const brandCount = multiBrandInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean).length;
      if (brandCount !== quantity) {
        setError("For multi-brand purchases, provide one comma-separated brand name per quantity.");
        return;
      }
    }

    startTransition(async () => {
      const result = await addCartItem({
        conferenceId,
        organizationId: selectedOrganizationId,
        productId: product.id,
        quantity,
        metadata,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setStatus(`Added ${product.name} to cart.`);
    });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        Buying as <strong>{selectedOrganizationType ?? "organization"}</strong>. Eligibility is enforced at add-to-cart and checkout.
      </div>

      {partnerMeetingProduct && isVendorPartner ? (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Partner Meeting Metadata</h2>
          <p className="text-xs text-gray-600">
            Partner meeting purchases require brand metadata for scheduler and badge workflows.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-gray-700">
              Single-brand name
              <input
                value={meetingBrandName}
                onChange={(event) => setMeetingBrandName(event.target.value)}
                placeholder="Primary brand"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-700">
              Multi-brand names (comma-separated)
              <input
                value={multiBrandInput}
                onChange={(event) => setMultiBrandInput(event.target.value)}
                placeholder="Brand A, Brand B"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="text-xs text-gray-700">
            Primary brand index (0-based for multi-brand)
            <input
              type="number"
              min={0}
              value={primaryBrandIndex}
              onChange={(event) => setPrimaryBrandIndex(Math.max(0, Number(event.target.value) || 0))}
              className="mt-1 w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {status ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{status}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {products.map((product) => {
          const quantity = Math.max(1, quantities[product.id] ?? 1);
          const disabled = product.eligibilityErrors.length > 0 || isPending;
          const remaining =
            product.capacity === null ? null : Math.max(0, product.capacity - product.current_sold);

          return (
            <article key={product.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{product.name}</h3>
                  <p className="mt-1 text-xs text-gray-600">{product.description ?? "No description."}</p>
                </div>
                <span className="text-sm font-semibold text-gray-900">{formatCents(product.price_cents)}</span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-600">
                <span>Slug: {product.slug}</span>
                <span>{remaining === null ? "Unlimited" : `${remaining} left`}</span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-gray-700">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [product.id]: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={disabled}
                  className="ml-auto rounded-md bg-[#D60001] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? "Adding..." : "Add to Cart"}
                </button>
              </div>

              {product.eligibilityErrors.length > 0 ? (
                <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2">
                  {product.eligibilityErrors.map((eligibilityError) => (
                    <li key={eligibilityError} className="text-xs text-amber-800">
                      {eligibilityError}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
