"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import OfferCard from "@/components/conference/OfferCard";
import { getConferenceCart } from "@/lib/actions/conference-commerce";
import {
  createWalkUpPerson,
  listDeskSaleOrganizations,
  loadDeskSaleOffers,
  lookupWalkUpEmail,
  type WalkUpMatch,
} from "@/lib/actions/desk-sale";
import type { AttendeeRef } from "@/lib/actions/conference-commerce";
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

  // Who a registration is for. Known when the desk sent a person; otherwise the
  // walk-up form below fills it — never by guessing from an email.
  const [attendee, setAttendee] = useState<AttendeeRef | null>(null);
  const [form, setForm] = useState({ name: context.personName ?? "", email: "", title: "", phone: "" });
  const [check, setCheck] = useState<{ sameName: WalkUpMatch | null; others: WalkUpMatch[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const knownPerson = Boolean(context.personId);
  const formReady = form.name.trim() && form.email.trim() && form.title.trim();

  const chooseMatch = (match: WalkUpMatch) => {
    setAttendee({ name: match.name, email: form.email.trim().toLowerCase(), contactId: match.contactId });
    setCheck(null);
  };
  const createNew = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const res = await createWalkUpPerson({
      conferenceId,
      organizationId: orgId,
      name: form.name,
      email: form.email,
      title: form.title,
      phone: form.phone || null,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setAttendee({ name: form.name.trim(), email: form.email.trim().toLowerCase(), contactId: res.data.contactId });
    setCheck(null);
  };
  // ⛔ Stephen's rules (project_shared_email_walkup_rules): same name on that
  // email is the same person; a different name is the OPERATOR's call; nobody
  // on it is someone new. An existing person is confirmed, never edited.
  const continueWalkUp = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const res = await lookupWalkUpEmail({ conferenceId, organizationId: orgId, email: form.email, name: form.name });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (!res.data.sameName && res.data.others.length === 0) {
      await createNew();
      return;
    }
    setCheck(res.data);
  };

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
          if (res.data.attendee?.name) setAttendee(res.data.attendee);
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
            {attendee?.name ? `For ${attendee.name}` : context.personName ? `For ${context.personName}` : "A walk-up"}
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
                  setAttendee(null);
                  setCheck(null);
                }}
                className="mb-4 min-h-12 rounded-lg border border-gray-300 px-4 text-base"
              >
                Change company
              </button>
            ) : null}
            {!knownPerson && !attendee ? (
              <div className="mb-6 max-w-xl rounded-xl border border-gray-200 p-5">
                {!check ? (
                  <>
                    <p className="mb-3 text-lg font-bold">Who is this for?</p>
                    <div className="space-y-3">
                      {(
                        [
                          ["name", "Name", "text"],
                          ["email", "Email", "email"],
                          ["title", "Job title", "text"],
                          ["phone", "Phone (optional)", "tel"],
                        ] as const
                      ).map(([key, label, type]) => (
                        <label key={key} className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
                          <input
                            type={type}
                            value={form[key]}
                            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                            className="min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base"
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        disabled={!formReady || busy}
                        onClick={() => void continueWalkUp()}
                        className="min-h-12 w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Checking…" : "Continue"}
                      </button>
                    </div>
                  </>
                ) : check.sameName ? (
                  <>
                    <p className="text-lg font-bold">{check.sameName.name} is already on file</p>
                    <p className="mt-1 text-base text-gray-700">
                      {[check.sameName.title, check.sameName.phone].filter(Boolean).join(" · ") || "No other details on file."}
                    </p>
                    <p className="mt-2 text-sm text-gray-500">
                      Their details stay as they are. If anything is out of date, their organisation&apos;s admin
                      changes it.
                    </p>
                    <button
                      type="button"
                      onClick={() => chooseMatch(check.sameName as WalkUpMatch)}
                      className="mt-4 min-h-12 w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white"
                    >
                      Continue with {check.sameName.name}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold">{form.email.trim()} is already used at this company</p>
                    <p className="mt-1 text-base text-gray-700">Is this one of these people?</p>
                    <div className="mt-3 space-y-2">
                      {check.others.map((m) => (
                        <button
                          key={m.contactId}
                          type="button"
                          onClick={() => chooseMatch(m)}
                          className="min-h-12 w-full rounded-lg border border-gray-300 px-4 text-left text-base"
                        >
                          Yes, it&apos;s {m.name}
                          {m.title ? <span className="ml-2 text-sm text-gray-500">{m.title}</span> : null}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void createNew()}
                        className="min-h-12 w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Adding…" : `No, ${form.name.trim()} is someone new who shares this address`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
            {!knownPerson && !attendee ? null : !groups && !error ? (
              <p className="text-base text-gray-500">Loading what they can buy…</p>
            ) : null}
            {(knownPerson || attendee) && groups && groups.length === 0 ? (
              <p className="text-base text-gray-600">There is nothing this company can buy right now.</p>
            ) : null}
            {(knownPerson || attendee ? groups ?? [] : []).map((group) => (
              <section key={group.key} className="mb-6">
                <h2 className="mb-3 text-lg font-bold">{group.title}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.offers.map(({ offer, reason }) => (
                    <div key={offer.id} className="flex flex-col">
                      {reason ? <p className="mb-1 text-sm font-medium text-gray-600">{reason}</p> : null}
                      <OfferCard
                        offer={offer}
                        conferenceId={conferenceId}
                        organizationId={org.id}
                        touch
                        attendee={attendee}
                      />
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
