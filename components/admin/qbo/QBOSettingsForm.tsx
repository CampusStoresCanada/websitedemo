"use client";

import { useState, useTransition } from "react";
import QBItemPicker from "./QBItemPicker";
import QBTaxCodePicker from "./QBTaxCodePicker";
import QBAccountPicker from "./QBAccountPicker";
import { PROVINCES } from "@/lib/constants/provinces";

interface PriceBand {
  maxAmount: number; // dollars
  itemId: string | null;
}

interface MembershipTaxCode {
  province: string;
  taxCodeId: string | null;
}

interface StripeMembershipTaxRate {
  province: string;
  stripeTaxRateId: string | null;
}

interface Props {
  defaultItemId: string | null;
  membershipItemId: string | null;
  partnershipItemId: string | null;
  priceBands: PriceBand[];
  conferencePartialRefundItemId: string | null;
  stripeDepositAccountId: string | null;
  membershipTaxCodes: MembershipTaxCode[];
  outsideCanadaTaxCode: string | null;
  publicTicketTaxCode: string | null;
  stripeMembershipTaxRateIds: StripeMembershipTaxRate[];
  stripeTaxRateIdOutsideCanada: string | null;
}

export default function QBOSettingsForm({
  defaultItemId: initialDefault,
  membershipItemId: initialMembership,
  partnershipItemId: initialPartnership,
  priceBands: initialBands,
  conferencePartialRefundItemId: initialConferencePartialRefund,
  stripeDepositAccountId: initialStripeDepositAccountId,
  membershipTaxCodes: initialMembershipTaxCodes,
  outsideCanadaTaxCode: initialOutsideCanadaTaxCode,
  publicTicketTaxCode: initialPublicTicketTaxCode,
  stripeMembershipTaxRateIds: initialStripeMembershipTaxRateIds,
  stripeTaxRateIdOutsideCanada: initialStripeTaxRateIdOutsideCanada,
}: Props) {
  const [defaultItemId, setDefaultItemId] = useState(initialDefault);
  const [membershipItemId, setMembershipItemId] = useState(initialMembership);
  const [partnershipItemId, setPartnershipItemId] = useState(initialPartnership);
  const [bands, setBands] = useState<PriceBand[]>(initialBands);
  const [conferencePartialRefundItemId, setConferencePartialRefundItemId] = useState(
    initialConferencePartialRefund
  );
  const [stripeDepositAccountId, setStripeDepositAccountId] = useState(initialStripeDepositAccountId);
  const [membershipTaxCodes, setMembershipTaxCodes] = useState<MembershipTaxCode[]>(
    initialMembershipTaxCodes
  );
  const [outsideCanadaTaxCode, setOutsideCanadaTaxCode] = useState(initialOutsideCanadaTaxCode);
  const [publicTicketTaxCode, setPublicTicketTaxCode] = useState(initialPublicTicketTaxCode);
  const [stripeMembershipTaxRateIds, setStripeMembershipTaxRateIds] = useState<StripeMembershipTaxRate[]>(
    initialStripeMembershipTaxRateIds
  );
  const [stripeTaxRateIdOutsideCanada, setStripeTaxRateIdOutsideCanada] = useState(
    initialStripeTaxRateIdOutsideCanada
  );
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateBand(index: number, patch: Partial<PriceBand>) {
    setBands((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function addBand() {
    setBands((prev) => [...prev, { maxAmount: 0, itemId: null }]);
  }

  function removeBand(index: number) {
    setBands((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTaxCode(index: number, patch: Partial<MembershipTaxCode>) {
    setMembershipTaxCodes((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function addTaxCode() {
    setMembershipTaxCodes((prev) => [...prev, { province: PROVINCES[0], taxCodeId: null }]);
  }

  function removeTaxCode(index: number) {
    setMembershipTaxCodes((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStripeTaxRate(index: number, patch: Partial<StripeMembershipTaxRate>) {
    setStripeMembershipTaxRateIds((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function addStripeTaxRate() {
    setStripeMembershipTaxRateIds((prev) => [...prev, { province: PROVINCES[0], stripeTaxRateId: null }]);
  }

  function removeStripeTaxRate(index: number) {
    setStripeMembershipTaxRateIds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setError(null);
    startSave(async () => {
      const res = await fetch("/api/admin/qbo/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultItemId,
          membershipItemId,
          partnershipItemId,
          priceBands: bands,
          conferencePartialRefundItemId,
          stripeDepositAccountId,
          membershipTaxCodes,
          outsideCanadaTaxCode,
          publicTicketTaxCode,
          stripeMembershipTaxRateIds,
          stripeTaxRateIdOutsideCanada,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Default Item</h2>
        <p className="text-xs text-gray-400 mb-4">
          Used for any paid invoice — partnership, add-on, and anything else — that doesn&apos;t
          have a more specific mapping below. Conference commerce (booths, registration,
          sponsorship) uses per-entity items mapped in the Build tab, and a tax code set on each
          conference&apos;s own Edit page.
        </p>
        <QBItemPicker value={defaultItemId} onChange={(id) => setDefaultItemId(id)} required />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Partnership</h2>
        <p className="text-xs text-gray-400 mb-4">QB item used for partnership invoices.</p>
        <QBItemPicker
          value={partnershipItemId}
          onChange={(id) => setPartnershipItemId(id)}
          label="Partnership Item"
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Membership Dues</h2>
        <p className="text-xs text-gray-400 mb-4">
          Dues are priced per organization by FTE, so a single flat item is usually wrong — add
          a price tier below for each QB dues item, entering the highest amount that tier covers.
          An invoice is matched to the first (lowest) tier whose amount covers it; anything above
          your highest tier still uses that top tier. With no tiers configured, every membership
          invoice uses the flat item below instead.
        </p>

        <QBItemPicker
          value={membershipItemId}
          onChange={(id) => setMembershipItemId(id)}
          label="Flat / fallback item (used if no tier matches)"
        />

        {bands.length > 0 && (
          <div className="mt-4 space-y-3">
            {bands.map((band, i) => (
              <div
                key={i}
                className="flex items-end gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Up to $</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={band.maxAmount}
                    onChange={(e) => updateBand(i, { maxAmount: parseFloat(e.target.value) || 0 })}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <QBItemPicker
                    value={band.itemId}
                    onChange={(id) => updateBand(i, { itemId: id })}
                    label="QB Item"
                  />
                </div>
                <button
                  onClick={() => removeBand(i)}
                  className="mb-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={addBand}
          className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + Add tier
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Membership Tax by Province</h2>
        <p className="text-xs text-gray-400 mb-4">
          Membership/partnership dues are taxed by the <em>member org&apos;s own</em> province —
          unlike conference commerce, which uses one flat code per conference. Map each province
          your members are in to its QuickBooks tax code; an org whose province isn&apos;t listed
          here will fail to export rather than guess. Orgs outside Canada use the fallback below
          instead.
        </p>

        {membershipTaxCodes.length > 0 && (
          <div className="space-y-3">
            {membershipTaxCodes.map((m, i) => (
              <div
                key={i}
                className="flex items-end gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Province</label>
                  <select
                    value={m.province}
                    onChange={(e) => updateTaxCode(i, { province: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  >
                    {PROVINCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <QBTaxCodePicker
                    value={m.taxCodeId}
                    onChange={(id) => updateTaxCode(i, { taxCodeId: id })}
                    label="Tax Code"
                  />
                </div>
                <button
                  onClick={() => removeTaxCode(i)}
                  className="mb-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={addTaxCode}
          className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + Add province
        </button>

        <div className="mt-4">
          <QBTaxCodePicker
            value={outsideCanadaTaxCode}
            onChange={(id) => setOutsideCanadaTaxCode(id)}
            label="Outside Canada (fallback)"
          />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">
          Membership Tax by Province — Stripe (Prospective Partner Checkout)
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Separate from the QuickBooks mapping above: when a brand-new prospect buys a booth and
          their first-year membership together in one Stripe checkout, the membership line item is
          taxed at this rate, by the buyer&apos;s own province. Enter the Stripe Tax Rate object ID
          (e.g. <code>txr_...</code>) for each province — provinces sharing a rate (5% GST-only:
          BC/AB/SK/MB/QC/NT/NU/YT; 13% ON; 14% NS; 15% NB/NL/PE) can reuse the same Tax Rate ID.
          Create these once in the Stripe Dashboard under Tax → Rates.
        </p>

        {stripeMembershipTaxRateIds.length > 0 && (
          <div className="space-y-3">
            {stripeMembershipTaxRateIds.map((m, i) => (
              <div
                key={i}
                className="flex items-end gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Province</label>
                  <select
                    value={m.province}
                    onChange={(e) => updateStripeTaxRate(i, { province: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  >
                    {PROVINCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Stripe Tax Rate ID</label>
                  <input
                    value={m.stripeTaxRateId ?? ""}
                    onChange={(e) => updateStripeTaxRate(i, { stripeTaxRateId: e.target.value })}
                    placeholder="txr_..."
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  onClick={() => removeStripeTaxRate(i)}
                  className="mb-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={addStripeTaxRate}
          className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + Add province
        </button>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1">Outside Canada (fallback) — Stripe Tax Rate ID</label>
          <input
            value={stripeTaxRateIdOutsideCanada ?? ""}
            onChange={(e) => setStripeTaxRateIdOutsideCanada(e.target.value)}
            placeholder="txr_..."
            className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Event Tickets — Public Registrants</h2>
        <p className="text-xs text-gray-400 mb-4">
          A ticket buyer tied to a member org is taxed by that org&apos;s own province (above). A
          public / non-member registrant has no org and no province on file, so this flat code is
          used instead — this is a normal, supported checkout path, not a data gap.
        </p>
        <QBTaxCodePicker
          value={publicTicketTaxCode}
          onChange={(id) => setPublicTicketTaxCode(id)}
          label="Public Registrant Tax Code"
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Conference Commerce Deposit Account</h2>
        <p className="text-xs text-gray-400 mb-4">
          Which QuickBooks bank/asset account Stripe-collected conference money is recorded
          against — used on both the Sales Receipt when a booth/registration/sponsorship is
          purchased and the Refund Receipt if it's later refunded, so the two land in the same
          account and net against each other correctly.
        </p>
        <QBAccountPicker
          value={stripeDepositAccountId}
          onChange={(id) => setStripeDepositAccountId(id)}
          label="Deposit Account"
          required
        />

        <p className="text-xs text-gray-400 mt-4 mb-2">
          A conference order refunded for less than its full amount posts as a single line at the
          refund amount against this item, rather than trying to re-split the original booth/
          registration/sponsorship lines — it uses that conference&apos;s own tax code (set on the
          conference&apos;s Edit page). A full refund doesn&apos;t need this — it mirrors the
          original sale&apos;s items exactly. Falls back to the Default Item above if unset.
        </p>
        <QBItemPicker
          value={conferencePartialRefundItemId}
          onChange={(id) => setConferencePartialRefundItemId(id)}
          label="Partial Refund Item"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-[#163D6D] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved ✓</span>}
      </div>
    </div>
  );
}
