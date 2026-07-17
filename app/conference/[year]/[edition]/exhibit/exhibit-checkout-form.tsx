"use client";

import { useState, useTransition } from "react";
import { createProspectiveBoothCheckout } from "@/lib/actions/prospective-booth-checkout";
import { formatCents } from "@/lib/utils";

export default function ExhibitCheckoutForm({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  booths,
}: {
  conferenceId: string;
  conferenceYear: number;
  conferenceEdition: string;
  booths: Array<{ id: string; name: string; priceCents: number }>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
        successUrl: `${baseUrl}${conferencePath}/exhibit/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}${conferencePath}/exhibit`,
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
        <span className="text-sm font-medium text-gray-700">Booth</span>
        <select value={boothId} onChange={(e) => setBoothId(e.target.value)} className={`mt-1 ${inputClass}`}>
          {booths.map((b) => (
            <option key={b.id} value={b.id}>
              Booth {b.name} — {formatCents(b.priceCents)}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[#EE2A2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Starting checkout…" : "Continue to payment"}
      </button>
      <p className="text-xs text-gray-500">
        Your card is charged for the booth plus a partnership membership deposit. This
        does not guarantee approval — the CSC board reviews every new partner
        application after payment.
      </p>
    </form>
  );
}
