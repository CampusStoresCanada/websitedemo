"use client";

import { useState, useTransition } from "react";
import type { AvailableTicket, LockedTicket } from "@/lib/events/tickets";
import { registerWithTicket, createEventCheckoutSession } from "@/lib/actions/event-tickets";

interface TicketSelectorProps {
  eventId: string;
  available: AvailableTicket[];
  locked: LockedTicket[];
  isAuthenticated: boolean;
}

export default function TicketSelector({
  eventId,
  available,
  locked,
  isAuthenticated,
}: TicketSelectorProps) {
  const [selected, setSelected] = useState<string | null>(
    available.length === 1 ? available[0].ticket.id : null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isAuthenticated) {
    return (
      <a
        href="/login"
        className="block w-full text-center px-5 py-3 rounded-xl bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold text-sm transition-colors"
      >
        Sign in to Register
      </a>
    );
  }

  if (available.length === 0 && locked.length === 0) {
    return null;
  }

  // All tickets are locked for this user — show why but no register CTA
  if (available.length === 0 && locked.length > 0 && !isAuthenticated) {
    return (
      <a
        href="/login"
        className="block w-full text-center px-5 py-3 rounded-xl bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold text-sm transition-colors"
      >
        Sign in to Register
      </a>
    );
  }

  function handleRegister() {
    if (!selected) { setError("Please select a ticket type"); return; }
    setError(null);

    startTransition(async () => {
      const ticket = available.find((a) => a.ticket.id === selected);
      if (!ticket) return;

      if (ticket.ticket.price_cents === 0) {
        const result = await registerWithTicket(eventId, selected);
        if (!result.success) {
          setError(result.error);
        } else {
          // Reload to show registered state
          window.location.reload();
        }
      } else {
        const result = await createEventCheckoutSession(eventId, selected);
        if (!result.success) {
          setError(result.error);
        } else {
          window.location.href = result.checkoutUrl;
        }
      }
    });
  }

  const selectedTicket = available.find((a) => a.ticket.id === selected);
  const isPaid = selectedTicket && selectedTicket.ticket.price_cents > 0;

  return (
    <div className="space-y-3">
      {/* Available tickets */}
      {available.map(({ ticket, priceLabel }) => (
        <button
          key={ticket.id}
          onClick={() => setSelected(ticket.id)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
            selected === ticket.id
              ? "border-[#EE2A2E] bg-red-50"
              : "border-gray-200 hover:border-gray-300 bg-white"
          }`}
        >
          <div>
            <p className="text-sm font-semibold text-gray-900">{ticket.name}</p>
            {ticket.description && (
              <p className="text-xs text-gray-500 mt-0.5">{ticket.description}</p>
            )}
          </div>
          <span
            className={`text-sm font-bold ml-4 shrink-0 ${
              selected === ticket.id ? "text-[#EE2A2E]" : "text-gray-700"
            }`}
          >
            {priceLabel}
          </span>
        </button>
      ))}

      {/* Locked tickets */}
      {locked.map(({ ticket, priceLabel, reason, upsellUrl }) => (
        <div
          key={ticket.id}
          className="flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 opacity-70"
        >
          <div>
            <p className="text-sm font-semibold text-gray-400">{ticket.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{reason}</p>
            {upsellUrl && (
              <a
                href={upsellUrl}
                className="text-xs text-[#EE2A2E] hover:underline mt-0.5 inline-block"
              >
                Learn more →
              </a>
            )}
          </div>
          <span className="text-sm font-bold text-gray-300 ml-4 shrink-0">{priceLabel}</span>
        </div>
      ))}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {available.length > 0 && (
        <button
          onClick={handleRegister}
          disabled={isPending || !selected}
          className="w-full px-5 py-3 rounded-xl bg-[#EE2A2E] hover:bg-[#D92327] disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {isPending
            ? "Processing…"
            : isPaid
            ? `Pay ${selectedTicket.priceLabel} →`
            : "Register →"}
        </button>
      )}
    </div>
  );
}
