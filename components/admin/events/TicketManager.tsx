"use client";

import { useState, useTransition } from "react";

function utcToLocalInput(utcIso: string): string {
  const d = new Date(utcIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
import type { EventTicketType, AudienceFilter } from "@/lib/events/tickets";
import { formatPrice } from "@/lib/events/tickets";

// ── Server actions (imported inline to keep file self-contained) ──
import {
  createTicketType,
  updateTicketType,
  deleteTicketType,
} from "@/lib/actions/event-ticket-admin";

interface TicketManagerProps {
  eventId: string;
  tickets: EventTicketType[];
}

const AUDIENCE_FILTER_OPTIONS = [
  { label: "Everyone",              value: "" },
  { label: "Any CSC member",        value: '{"type":"org_type","value":"member"}' },
  { label: "Any CSC partner",       value: '{"type":"org_type","value":"partner"}' },
  { label: "Admin / staff only",    value: '{"type":"global_role","value":"admin"}' },
];

function audienceFilterLabel(filter: AudienceFilter | null): string {
  if (!filter) return "Everyone";
  if (filter.type === "org_type") {
    return filter.value === "member" ? "CSC members only" : `${filter.value}s only`;
  }
  if (filter.type === "partner_category") return `Partner: ${filter.value}`;
  if (filter.type === "global_role") return `Role: ${filter.value}`;
  if (filter.type === "membership_status") return `Membership: ${filter.value}`;
  if (filter.type === "org_fte") return `FTE ${filter.operator} ${filter.value}`;
  return "Custom";
}

// ── Blank form state ──────────────────────────────────────────────

function blankForm() {
  return {
    name: "",
    description: "",
    price_dollars: "",       // display field; converted to cents on submit
    capacity: "",
    sort_order: "0",
    audience_filter_raw: "",
    available_from: "",
    available_until: "",
    is_hidden: false,
  };
}

type FormState = ReturnType<typeof blankForm>;

function formFromTicket(t: EventTicketType): FormState {
  return {
    name: t.name,
    description: t.description ?? "",
    price_dollars: t.price_cents === 0 ? "0" : (t.price_cents / 100).toFixed(2),
    capacity: t.capacity != null ? String(t.capacity) : "",
    sort_order: String(t.sort_order),
    audience_filter_raw: t.audience_filter ? JSON.stringify(t.audience_filter) : "",
    available_from: t.available_from ? utcToLocalInput(t.available_from) : "",
    available_until: t.available_until ? utcToLocalInput(t.available_until) : "",
    is_hidden: t.is_hidden,
  };
}

// ── Component ─────────────────────────────────────────────────────

export default function TicketManager({ eventId, tickets: initial }: TicketManagerProps) {
  const [tickets, setTickets] = useState<EventTicketType[]>(initial);
  const [editing, setEditing] = useState<string | null>(null); // ticket id or "new"
  const [form, setForm] = useState<FormState>(blankForm());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openNew() {
    setForm(blankForm());
    setEditing("new");
    setError(null);
  }

  function openEdit(t: EventTicketType) {
    setForm(formFromTicket(t));
    setEditing(t.id);
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setError(null);
  }

  function patch(field: keyof FormState, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function submit() {
    const priceCents = Math.round(parseFloat(form.price_dollars || "0") * 100);
    if (isNaN(priceCents) || priceCents < 0) {
      setError("Invalid price");
      return;
    }

    let audienceFilter: AudienceFilter | null = null;
    if (form.audience_filter_raw) {
      try {
        audienceFilter = JSON.parse(form.audience_filter_raw);
      } catch {
        setError("Invalid audience filter JSON");
        return;
      }
    }

    const payload = {
      event_id: eventId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price_cents: priceCents,
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      sort_order: parseInt(form.sort_order, 10) || 0,
      audience_filter: audienceFilter,
      available_from: form.available_from || null,
      available_until: form.available_until || null,
      is_hidden: form.is_hidden,
    };

    if (!payload.name) { setError("Name is required"); return; }

    setError(null);
    startTransition(async () => {
      if (editing === "new") {
        const result = await createTicketType(payload);
        if (!result.success) { setError(result.error); return; }
        setTickets((prev) => [...prev, result.data]);
      } else if (editing) {
        const result = await updateTicketType(editing, payload);
        if (!result.success) { setError(result.error); return; }
        setTickets((prev) => prev.map((t) => (t.id === editing ? result.data : t)));
      }
      setEditing(null);
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this ticket type? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteTicketType(id);
      if (!result.success) { alert(result.error); return; }
      setTickets((prev) => prev.filter((t) => t.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {tickets.length === 0
              ? "No ticket types — this event uses the free registration flow."
              : `${tickets.length} ticket type${tickets.length !== 1 ? "s" : ""} configured.`}
          </p>
        </div>
        {editing === null && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold transition-colors"
          >
            + Add Ticket Type
          </button>
        )}
      </div>

      {/* Ticket list */}
      {tickets.length > 0 && (
        <div className="space-y-2">
          {tickets.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                  {t.is_hidden && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Hidden</span>
                  )}
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                    {formatPrice(t.price_cents)}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {audienceFilterLabel(t.audience_filter)}
                  {t.capacity != null && ` · ${t.capacity} spots`}
                  {t.stripe_price_id && " · Stripe linked"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(t.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      {editing !== null && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">
            {editing === "new" ? "New Ticket Type" : "Edit Ticket Type"}
          </h3>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="e.g. Member Rate, Early Bird"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Price (CAD)</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm text-gray-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price_dollars}
                  onChange={(e) => patch("price_dollars", e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patch("description", e.target.value)}
                placeholder="Shown to users during checkout"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Who can buy</label>
              <select
                value={AUDIENCE_FILTER_OPTIONS.some((o) => o.value === form.audience_filter_raw) ? form.audience_filter_raw : "__custom__"}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") patch("audience_filter_raw", e.target.value);
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              >
                {AUDIENCE_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!AUDIENCE_FILTER_OPTIONS.some((o) => o.value === form.audience_filter_raw) && form.audience_filter_raw && (
                  <option value="__custom__">Custom (JSON below)</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Capacity <span className="text-gray-400">(blank = event capacity)</span>
              </label>
              <input
                type="number"
                min="1"
                value={form.capacity}
                onChange={(e) => patch("capacity", e.target.value)}
                placeholder="Unlimited"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Available from</label>
              <input
                type="datetime-local"
                value={form.available_from}
                onChange={(e) => patch("available_from", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Available until</label>
              <input
                type="datetime-local"
                value={form.available_until}
                onChange={(e) => patch("available_until", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sort order</label>
              <input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) => patch("sort_order", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30"
              />
            </div>

            <div className="flex items-center gap-2 pt-5">
              <input
                id="is_hidden"
                type="checkbox"
                checked={form.is_hidden}
                onChange={(e) => patch("is_hidden", e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="is_hidden" className="text-xs font-medium text-gray-600">
                Hidden (comp / invite-only ticket)
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={submit}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancel}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
