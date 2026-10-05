"use client";

import { useState, useTransition } from "react";
import { createProspectiveBoothCheckout } from "@/lib/actions/prospective-booth-checkout";
import { formatCents } from "@/lib/utils";
import { PROVINCES } from "@/lib/constants/provinces";

/**
 * Pay-first checkout for someone with no CSC account yet: they are charged for
 * the thing AND for the partnership in one Stripe session, then routed into the
 * application pipeline.
 *
 * Not booth-only. Conference in a Box is sold to anyone, exhibiting or not, and
 * a non-partner buying one needs exactly this flow — so the form takes a list
 * of offers rather than a list of booths. A single offer renders as a line of
 * text, because a <select> with one option is a decision nobody is making.
 */
export default function ExhibitCheckoutForm({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  booths,
  label = "Booth",
  namePrefix = "Booth ",
  successUrl,
  cancelUrl,
  footnote,
}: {
  conferenceId: string;
  conferenceYear: number;
  conferenceEdition: string;
  /** The things on offer. Named `booths` for the exhibit page that predates this. */
  booths: Array<{ id: string; name: string; priceCents: number }>;
  /** Field label above the picker. */
  label?: string;
  /** Prefix on each option, e.g. "Booth 204". Empty for products named in full. */
  namePrefix?: string;
  /** Where Stripe returns to. Defaults to the exhibit success/cancel pages. */
  successUrl?: string;
  cancelUrl?: string;
  /** Replaces the "charged for the booth plus a partnership deposit" line. */
  footnote?: string;
}) {
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [province, setProvince] = useState("");
  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const onlyOffer = booths.length === 1 ? booths[0] : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const baseUrl = window.location.origin;
      const conferencePath = `/conference/${conferenceYear}/${conferenceEdition}`;
      const result = await createProspectiveBoothCheckout({
        conferenceId,
        boothEntityId: boothId,
        companyName,
        email,
        province,
        successUrl:
          successUrl ?? `${baseUrl}${conferencePath}/exhibit/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl ?? `${baseUrl}${conferencePath}/exhibit`,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.location.href = result.data.checkoutUrl;
    });
  };

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]";

  return (
    <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Company name</span>
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Contact email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Province</span>
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          required
          className={`mt-1 ${inputClass} bg-white`}
        >
          <option value="">Select…</option>
          <option value="Out of Canada">Out of Canada</option>
          <optgroup label="Canadian Provinces &amp; Territories">
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="mt-1 block text-xs text-gray-400">
          Determines the tax rate on your membership dues line.
        </span>
      </label>
      <div className="block">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {onlyOffer ? (
          <p className="mt-1 text-sm text-gray-900">
            {namePrefix}
            {onlyOffer.name} — {formatCents(onlyOffer.priceCents)}
          </p>
        ) : (
          <select value={boothId} onChange={(e) => setBoothId(e.target.value)} className={`mt-1 ${inputClass}`}>
            {booths.map((b) => (
              <option key={b.id} value={b.id}>
                {namePrefix}
                {b.name} — {formatCents(b.priceCents)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[#EE2A2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Starting checkout…" : "Continue to payment"}
      </button>
      <p className="text-xs text-gray-500">
        {footnote ??
          "Your card is charged for the booth plus a partnership membership deposit. This does not guarantee approval — the CSC board reviews every new partner application after payment."}
      </p>
    </form>
  );
}
