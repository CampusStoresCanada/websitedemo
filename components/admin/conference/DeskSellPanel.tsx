"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import OfferCard from "@/components/conference/OfferCard";
import { getConferenceCart } from "@/lib/actions/conference-commerce";
import { listDeskSaleOrganizations, loadDeskSaleOffers } from "@/lib/actions/desk-sale";
import { CONFERENCE_CART_UPDATED_EVENT } from "@/lib/conference/cart-events";
import type { DeskOfferGroup } from "@/lib/conference/desk-offers";
import { formatCents } from "@/lib/utils";

/**
 * Selling at the desk, without leaving it.
 *
 * ⛔ Built from the storefront's own pieces — the same OfferCard and the same
 * cart — so a sale here prices, taxes and checks exactly like one online. What
 * is the desk's own: the company is chosen here, what Find already knew is
 * carried in, and the offers are ordered for the person standing there
 * (lib/conference/desk-offers.ts).
 */

export type DeskSellContext = {
  /** The person at the desk, when the desk knows them (scan or Find). */
  personId?: string | null;
  personName?: string | null;
  /** Their company, when known. */
  organizationId?: string | null;
  /** What was typed into Find, to pre-fill the company search. */
  companyHint?: string | null;
};

type Org = { id: string; name: string; type: string | null };

export default function DeskSellPanel({
  conferenceId,
  storefrontPath,
  context,
  onClose,
}: {
  conferenceId: string;
  storefrontPath: string;
  context: DeskSellContext;
  onClose: () => void;
}) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(context.organizationId ?? null);
  const [companySearch, setCompanySearch] = useState(context.companyHint ?? "");
  const [groups, setGroups] = useState<DeskOfferGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<{ count: number; totalCents: number } | null>(null);

  useEffect(() => {
    void listDeskSaleOrganizations(conferenceId).then((res) => {
      if (res.success) setOrgs(res.data);
      else setError(res.error);
    });
  }, [conferenceId]);

  const org = useMemo(() => orgs?.find((o) => o.id === orgId) ?? null, [orgs, orgId]);

  const companyMatches = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!orgs || q.length < 2) return [];
    return orgs.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 8);
  }, [orgs, companySearch]);

  const refreshCart = useCallback(async () => {
    if (!orgId) return;
    const res = await getConferenceCart(conferenceId, orgId);
    if (res.success) {
      const count = res.data.offerItems.reduce((n, item) => n + item.quantity, 0);
      setCart({ count, totalCents: res.data.totalCents });
    }
  }, [conferenceId, orgId]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void loadDeskSaleOffers({ conferenceId, organizationId: orgId, personId: context.personId ?? null }).then(
      (res) => {
        if (cancelled) return;
        if (res.success) {
          setGroups(res.data.groups);
          setError(null);
        } else setError(res.error);
      }
    );
    void getConferenceCart(conferenceId, orgId).then((res) => {
      if (cancelled || !res.success) return;
      setCart({
        count: res.data.offerItems.reduce((n, item) => n + item.quantity, 0),
        totalCents: res.data.totalCents,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [conferenceId, orgId, context.personId]);

  // The cart total follows every add, through the same signal the site header uses.
  useEffect(() => {
    const onUpdate = () => void refreshCart();
    window.addEventListener(CONFERENCE_CART_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CONFERENCE_CART_UPDATED_EVENT, onUpdate);
  }, [refreshCart]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white text-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xl font-bold">Sell</p>
          <p className="truncate text-base text-gray-600">
            {context.personName ? `For ${context.personName}` : "A walk-up"}
            {org ? ` · ${org.name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-12 shrink-0 rounded-lg border border-gray-300 px-5 text-base font-medium"
        >
          Back to the desk
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error ? <p className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">{error}</p> : null}

        {!org ? (
          <div className="mx-auto max-w-xl">
            <label className="mb-2 block text-base font-semibold">Which company are they with?</label>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the one thing to do on this screen */}
            <input
              autoFocus
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              placeholder="Company name"
              className="min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base"
            />
            {!orgs ? <p className="mt-3 text-base text-gray-500">Loading companies…</p> : null}
            <div className="mt-3 space-y-2">
              {companyMatches.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOrgId(o.id)}
                  className="min-h-12 w-full rounded-lg border border-gray-300 px-4 text-left text-base hover:bg-gray-50"
                >
                  {o.name}
                  {o.type ? <span className="ml-2 text-sm text-gray-500">{o.type}</span> : null}
                </button>
              ))}
              {orgs && companySearch.trim().length >= 2 && companyMatches.length === 0 ? (
                <p className="text-base text-gray-600">
                  No company by that name. Check the spelling, or add the company first.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            {!context.organizationId ? (
              <button
                type="button"
                onClick={() => {
                  setOrgId(null);
                  setGroups(null);
                  setCart(null);
                }}
                className="mb-4 min-h-12 rounded-lg border border-gray-300 px-4 text-base"
              >
                Change company
              </button>
            ) : null}
            {!groups && !error ? <p className="text-base text-gray-500">Loading what they can buy…</p> : null}
            {groups && groups.length === 0 ? (
              <p className="text-base text-gray-600">There is nothing this company can buy right now.</p>
            ) : null}
            {(groups ?? []).map((group) => (
              <section key={group.key} className="mb-6">
                <h2 className="mb-3 text-lg font-bold">{group.title}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.offers.map(({ offer, reason }) => (
                    <div key={offer.id} className="flex flex-col">
                      {reason ? <p className="mb-1 text-sm font-medium text-gray-600">{reason}</p> : null}
                      <OfferCard offer={offer} conferenceId={conferenceId} organizationId={org.id} touch />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {org ? (
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4">
          <p className="text-base">
            {cart && cart.count > 0
              ? `${cart.count} in the cart · ${formatCents(cart.totalCents)}`
              : "Nothing in the cart yet"}
          </p>
          {/* ⚠️ Interim: opens the ordinary cart to name them and pay, until the
              desk's own payment screen replaces it. */}
          <a
            href={`${storefrontPath}/cart?org=${org.id}`}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!cart || cart.count === 0}
            className={`inline-flex min-h-12 items-center rounded-lg px-5 text-base font-semibold ${
              cart && cart.count > 0 ? "bg-gray-900 text-white" : "pointer-events-none bg-gray-200 text-gray-500"
            }`}
          >
            Review and pay →
          </a>
        </div>
      ) : null}
    </div>
  );
}
