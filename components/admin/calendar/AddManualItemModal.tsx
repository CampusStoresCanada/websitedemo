"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CalendarCategory,
  CalendarLayer,
  CalendarSeverity,
  CalendarStatus,
  CreateManualItemPayload,
} from "@/lib/calendar/types";

type Props = {
  onClose: () => void;
};

const CATEGORIES: { value: CalendarCategory; label: string }[] = [
  { value: "conference",       label: "Conference" },
  { value: "renewals_billing", label: "Renewals / Billing" },
  { value: "legal_retention",  label: "Legal / Retention" },
  { value: "communications",   label: "Communications" },
  { value: "integrations_ops", label: "Integrations / Ops" },
];

const LAYERS: { value: CalendarLayer; label: string }[] = [
  { value: "people",     label: "People" },
  { value: "admin_ops",  label: "Admin Ops" },
  { value: "system_ops", label: "System Ops" },
];

const LENGTHS: { value: number; label: string }[] = [
  { value: 15,  label: "15 min" },
  { value: 30,  label: "30 min" },
  { value: 60,  label: "1 hour" },
  { value: 90,  label: "90 min" },
];

const ALL_TIMES: { value: string; label: string }[] = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const label = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      opts.push({ value: `${hh}:${mm}`, label });
    }
  }
  return opts;
})();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextQuarterHourTime(): string {
  const d = new Date();
  const ms = 15 * 60 * 1000;
  const next = new Date(Math.ceil(d.getTime() / ms) * ms);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

export default function AddManualItemModal({ onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = todayStr();

  const [form, setForm] = useState<{
    title: string;
    description: string;
    category: CalendarCategory;
    layer: CalendarLayer;
    start_date: string;
    start_time: string;
    length: number;
    status: CalendarStatus;
    severity: CalendarSeverity;
  }>({
    title:       "",
    description: "",
    category:    "conference",
    layer:       "admin_ops",
    start_date:  today,
    start_time:  nextQuarterHourTime(),
    length:      60,
    status:      "planned",
    severity:    "normal",
  });

  const minTime = form.start_date === today ? nextQuarterHourTime() : "00:00";
  const timeOptions = ALL_TIMES.filter((t) => form.start_date > today || t.value >= minTime);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.title.trim() || !form.start_date || !form.start_time) {
      setError("Title and start date/time are required.");
      return;
    }

    const startsAt = new Date(`${form.start_date}T${form.start_time}`);
    const endsAt = new Date(startsAt.getTime() + form.length * 60 * 1000);

    const payload: CreateManualItemPayload = {
      title:       form.title.trim(),
      description: form.description.trim() || undefined,
      category:    form.category,
      layer:       form.layer,
      starts_at:   startsAt.toISOString(),
      ends_at:     endsAt.toISOString(),
      status:      form.status,
      severity:    form.severity,
    };

    const res = await fetch("/api/admin/calendar/items", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const { error: msg } = (await res.json()) as { error?: string };
      setError(msg ?? "Failed to create item.");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Add Manual Item</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe the operational item"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional context or notes"
            />
          </div>

          {/* Category + Layer */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value as CalendarCategory)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Layer *</label>
              <select
                value={form.layer}
                onChange={(e) => set("layer", e.target.value as CalendarLayer)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {LAYERS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
            <input
              type="date"
              value={form.start_date}
              min={today}
              onChange={(e) => {
                set("start_date", e.target.value);
                if (e.target.value === todayStr()) {
                  const min = nextQuarterHourTime();
                  if (form.start_time < min) set("start_time", min);
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Time + Length */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Time *</label>
              <select
                value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {timeOptions.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Length *</label>
              <select
                value={form.length}
                onChange={(e) => set("length", Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {LENGTHS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status + Severity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value as CalendarStatus)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => set("severity", e.target.value as CalendarSeverity)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="normal">Normal</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Add Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
