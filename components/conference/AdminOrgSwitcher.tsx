"use client";

import { useRouter } from "next/navigation";

/**
 * Global-admin-only "shop as this org" picker — lets an admin drive the real
 * offers/cart/dev-checkout flow on behalf of ANY organization, not just ones
 * they personally belong to. The commerce actions (addOfferToCart,
 * devCompleteConferenceCheckout, etc.) already permit this for global admins;
 * this is the missing UI to actually reach it. Native <select> instead of a
 * custom combobox — this is an internal admin tool, not the member storefront,
 * and browsers already support type-ahead jump in a long <select>.
 */
export default function AdminOrgSwitcher({
  orgs,
  selectedOrgId,
  basePath,
}: {
  orgs: { id: string; name: string }[];
  selectedOrgId: string | null;
  basePath: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
      <span className="text-xs font-medium text-amber-800">Admin: shop as</span>
      <select
        value={selectedOrgId ?? ""}
        onChange={(e) => router.push(`${basePath}?org=${e.target.value}`)}
        className="rounded border border-amber-300 bg-white px-2 py-1 text-sm text-gray-900"
      >
        <option value="" disabled>
          Select an organization…
        </option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  );
}
