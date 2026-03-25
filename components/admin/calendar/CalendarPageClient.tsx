"use client";

import { useState } from "react";
import { parseUTC } from "@/lib/utils";
import type {
  CalendarItemEnriched,
  CalendarLayer,
  DaySaturation,
} from "@/lib/calendar/types";
import CalendarAutoRefresh from "./CalendarAutoRefresh";
import CalendarListView from "./CalendarListView";
import CalendarGridView from "./CalendarGridView";
import CalendarSaturationBar from "./CalendarSaturationBar";
import AddManualItemModal from "./AddManualItemModal";

// ── Layer config ──────────────────────────────────────────────────

const LAYERS: { key: CalendarLayer; label: string; dot: string }[] = [
  { key: "people",     label: "People",     dot: "bg-blue-400" },
  { key: "admin_ops",  label: "Admin Ops",  dot: "bg-purple-400" },
  { key: "system_ops", label: "System Ops", dot: "bg-orange-400" },
];

// ── Month nav helpers ─────────────────────────────────────────────

function offsetMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", {
    month: "long",
    year:  "numeric",
    timeZone: "America/Toronto",
  });
}

// ── Component ─────────────────────────────────────────────────────

type Props = {
  items: CalendarItemEnriched[];
  saturation: DaySaturation[];
  syncedAt: string;
};

type ViewMode = "list" | "grid";

export default function CalendarPageClient({ items, saturation, syncedAt }: Props) {
  const [activeLayers, setActiveLayers] = useState<Set<CalendarLayer>>(
    new Set(["people", "admin_ops", "system_ops"])
  );
  const [viewMode, setViewMode]   = useState<ViewMode>("list");
  const [month, setMonth]         = useState(currentMonth);
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery]         = useState("");

  function toggleLayer(layer: CalendarLayer) {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }

  const needle = query.trim().toLowerCase();
  const visibleItems = needle
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          (i.description ?? "").toLowerCase().includes(needle) ||
          i.category.toLowerCase().includes(needle) ||
          i.source_key?.toLowerCase().includes(needle)
      )
    : items;

  const syncLabel = parseUTC(syncedAt).toLocaleTimeString("en-CA", {
    hour:   "2-digit",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });

  return (
    <>
      <CalendarAutoRefresh intervalMs={20000} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operational Calendar</h1>
          <p className="mt-0.5 text-xs text-gray-500">Synced at {syncLabel} ET</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Item
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items…"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Saturation banner */}
      <div className="mb-4">
        <CalendarSaturationBar saturation={saturation} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Layer toggles */}
        <div className="flex items-center gap-2">
          {LAYERS.map(({ key, label, dot }) => (
            <button
              key={key}
              onClick={() => toggleLayer(key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                activeLayers.has(key)
                  ? "bg-white border-gray-300 text-gray-800 shadow-sm"
                  : "bg-gray-100 border-transparent text-gray-400"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeLayers.has(key) ? dot : "bg-gray-300"}`} />
              {label}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs">
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 font-medium ${
              viewMode === "list" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1.5 font-medium border-l border-gray-200 ${
              viewMode === "grid" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Grid
          </button>
        </div>

        {/* Month nav (grid only) */}
        {viewMode === "grid" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMonth((m) => offsetMonth(m, -1))}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              ←
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">
              {monthLabel(month)}
            </span>
            <button
              onClick={() => setMonth((m) => offsetMonth(m, 1))}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              →
            </button>
            <button
              onClick={() => setMonth(currentMonth())}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              Today
            </button>
          </div>
        )}
      </div>

      {/* View */}
      {viewMode === "list" ? (
        <CalendarListView items={visibleItems} activeLayers={activeLayers} />
      ) : (
        <CalendarGridView
          items={visibleItems}
          activeLayers={activeLayers}
          saturation={saturation}
          month={month}
        />
      )}

      {/* Modal */}
      {showModal && <AddManualItemModal onClose={() => setShowModal(false)} />}
    </>
  );
}
