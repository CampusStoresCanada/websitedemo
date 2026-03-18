"use client";

import { useState, useTransition } from "react";
import { getOrgMembersEligibleForEvent, orgAdminRegisterMembers } from "@/lib/actions/event-registration";
import { orgAdminBulkCheckout } from "@/lib/actions/event-tickets";

interface TicketOption {
  id: string;
  name: string;
  price_cents: number;
  priceLabel: string;
}

interface Props {
  eventId: string;
  orgId: string;
  orgName: string;
  /** Available ticket types resolved for this org admin. Omit for free events. */
  availableTickets?: TicketOption[];
}

type Member = { user_id: string; display_name: string | null };

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export default function OrgMemberRegistrationPanel({ eventId, orgId, orgName, availableTickets }: Props) {
  const allTickets = availableTickets ?? [];
  const isPaidFlow = allTickets.some((t) => t.price_cents > 0);

  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedTicketId, setSelectedTicketId] = useState<string>(allTickets[0]?.id ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ registered: number; skipped: number } | null>(null);

  const selectedTicket = allTickets.find((t) => t.id === selectedTicketId) ?? allTickets[0] ?? null;
  const totalCents = selected.size * (selectedTicket?.price_cents ?? 0);

  async function handleOpen() {
    setOpen(true);
    setError(null);
    setResult(null);
    if (!members) {
      setIsLoading(true);
      const res = await getOrgMembersEligibleForEvent(eventId, orgId);
      setIsLoading(false);
      if (res.success) setMembers(res.data);
      else setError(res.error);
    }
  }

  function handleClose() {
    setOpen(false);
    setSelected(new Set());
    setSearch("");
    setError(null);
  }

  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  function handleConfirm() {
    if (selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      if (isPaidFlow) {
        const ticketId = selectedTicket?.id;
        if (!ticketId) return;
        const res = await orgAdminBulkCheckout(eventId, ticketId, Array.from(selected), orgId);
        if (res.success) {
          window.location.href = res.checkoutUrl;
        } else {
          setError(res.error);
        }
      } else {
        const res = await orgAdminRegisterMembers(eventId, Array.from(selected), orgId);
        if (res.success) {
          setResult({ registered: res.registered, skipped: res.skipped });
          setMembers((prev) => (prev ? prev.filter((m) => !selected.has(m.user_id)) : null));
          setSelected(new Set());
          setSearch("");
        } else {
          setError(res.error);
        }
      }
    });
  }

  const filtered = (members ?? []).filter(
    (m) => !search || (m.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="border-t border-gray-100 pt-4 mt-4">
      {!open ? (
        <button
          onClick={handleOpen}
          className="w-full text-left flex items-center justify-between gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors group"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Register someone from {orgName}
          </span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Register from {orgName}</p>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {result && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {result.registered} member{result.registered !== 1 ? "s" : ""} registered
              {result.skipped > 0 ? ` (${result.skipped} already registered or skipped)` : ""}.
              They&rsquo;ll receive a confirmation email.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Ticket selector — only shown when the event has ticket types */}
          {allTickets.length > 1 && (
            <select
              value={selectedTicket?.id ?? ""}
              onChange={(e) => setSelectedTicketId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            >
              {allTickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.priceLabel}
                </option>
              ))}
            </select>
          )}

          {allTickets.length === 1 && (
            <p className="text-xs text-gray-500">
              Ticket: <span className="font-medium text-gray-700">{allTickets[0].name}</span> — {allTickets[0].priceLabel}
            </p>
          )}

          {isLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading members…</p>
          ) : (members ?? []).length === 0 && !isLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">All org members are already registered.</p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search members…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
                autoFocus
              />

              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {filtered.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No members match.</p>
                ) : (
                  filtered.slice(0, 30).map((m) => (
                    <label
                      key={m.user_id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.user_id)}
                        onChange={() => toggleMember(m.user_id)}
                        className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                      />
                      <span className="text-sm text-gray-900">
                        {m.display_name ?? <span className="text-gray-400 italic">No name</span>}
                      </span>
                    </label>
                  ))
                )}
              </div>

              {selected.size > 0 && (
                <button
                  onClick={handleConfirm}
                  disabled={isPending}
                  className="w-full px-4 py-2.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  {isPending
                    ? isPaidFlow ? "Preparing checkout…" : "Registering…"
                    : isPaidFlow
                      ? `Pay for ${selected.size} member${selected.size !== 1 ? "s" : ""} — ${formatCents(totalCents)}`
                      : `Register ${selected.size} member${selected.size !== 1 ? "s" : ""}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
