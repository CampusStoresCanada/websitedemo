"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPlacementSlot, updatePlacementSlot } from "@/lib/actions/sponsorship";
import type { SponsorPlacementSlot, PlacementLocation } from "@/lib/sponsorship/types";

const LOCATION_LABELS: Record<PlacementLocation, string> = {
  website:    "Website",
  conference: "Conference",
  circle:     "Circle",
  email:      "Email",
};

const LOCATION_ORDER: PlacementLocation[] = ["website", "conference", "circle", "email"];

interface SlotsPanelProps {
  slots: SponsorPlacementSlot[];
}

function blankForm() {
  return { key: "", label: "", description: "", location: "website" as PlacementLocation, display_order: "0" };
}

export default function SlotsPanel({ slots: initial }: SlotsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [slots, setSlots] = useState(initial);
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState<string | null>(null);

  function patchForm(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function autoKey(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  }

  function handleToggle(slot: SponsorPlacementSlot) {
    startTransition(async () => {
      const result = await updatePlacementSlot(slot.id, { is_active: !slot.is_active });
      if (result.success) {
        setSlots((prev) => prev.map((s) => (s.id === slot.id ? result.data : s)));
        router.refresh();
      }
    });
  }

  function handleCreate() {
    if (!form.key.trim() || !form.label.trim()) { setError("Key and label are required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createPlacementSlot({
        key: form.key.trim(),
        label: form.label.trim(),
        description: form.description.trim() || null,
        location: form.location,
        display_order: parseInt(form.display_order, 10) || 0,
        is_active: true,
        config_schema: {},
      });
      if (result.success) {
        setSlots((prev) => [...prev, result.data]);
        setShowNew(false);
        setForm(blankForm());
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const visible = showInactive ? slots : slots.filter((s) => s.is_active);

  const grouped = LOCATION_ORDER.map((loc) => ({
    location: loc,
    label: LOCATION_LABELS[loc],
    items: visible.filter((s) => s.location === loc),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show inactive slots
        </label>
        {!showNew && (
          <button
            onClick={() => { setShowNew(true); setError(null); setForm(blankForm()); }}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
          >
            + New Slot
          </button>
        )}
      </div>

      {/* New slot form */}
      {showNew && (
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
          <p className="text-sm font-semibold text-gray-700">New Placement Slot</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Label *</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => patchForm({ label: e.target.value, key: autoKey(e.target.value) })}
                placeholder="Conference — Footer"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Key *</label>
              <input
                type="text"
                value={form.key}
                onChange={(e) => patchForm({ key: e.target.value })}
                placeholder="conference_footer"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
              <select
                value={form.location}
                onChange={(e) => patchForm({ location: e.target.value as PlacementLocation })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
              >
                {LOCATION_ORDER.map((l) => (
                  <option key={l} value={l}>{LOCATION_LABELS[l]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Display order</label>
              <input
                type="number"
                value={form.display_order}
                onChange={(e) => patchForm({ display_order: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patchForm({ description: e.target.value })}
                placeholder="Where this placement appears…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {isPending ? "Creating…" : "Create Slot"}
            </button>
            <button
              onClick={() => { setShowNew(false); setError(null); }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Grouped slot list */}
      {grouped.length === 0 && !showNew ? (
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No placement slots</p>
          <p className="text-sm mt-1">Add a slot to register a location where sponsors can appear.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ location, label, items }) => (
            <div key={location}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
              <div className="space-y-1.5">
                {items.map((slot) => (
                  <div
                    key={slot.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border ${
                      slot.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {slot.key}
                        </span>
                        <span className="text-sm text-gray-700 font-medium">{slot.label}</span>
                        {!slot.is_active && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
                        )}
                      </div>
                      {slot.description && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{slot.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggle(slot)}
                      disabled={isPending}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50 shrink-0 ${
                        slot.is_active
                          ? "border-amber-200 text-amber-600 hover:bg-amber-50"
                          : "border-green-200 text-green-600 hover:bg-green-50"
                      }`}
                    >
                      {slot.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
