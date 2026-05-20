"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateSponsorPlacement,
  deleteSponsorPlacement,
  createSponsorPlacement,
} from "@/lib/actions/sponsorship";
import type { SponsorPlacementWithContext, SponsorPlacementSlot } from "@/lib/sponsorship/types";

interface PlacementsManagerProps {
  agreementId: string;
  placements: SponsorPlacementWithContext[];
  availableSlots: SponsorPlacementSlot[];
  /** Pre-seeded from org profile — shown as defaults in the edit form */
  orgLogoUrl?: string | null;
  orgWebsite?: string | null;
}

export default function PlacementsManager({
  agreementId,
  placements: initial,
  availableSlots,
  orgLogoUrl,
  orgWebsite,
}: PlacementsManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [placements, setPlacements] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    logo_url: string;
    link_url: string;
    display_order: string;
    start_date: string;
    end_date: string;
  } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSlotId, setNewSlotId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const usedSlotIds = new Set(placements.map((p) => p.slot_id));
  const unusedSlots = availableSlots.filter((s) => !usedSlotIds.has(s.id));

  function startEdit(p: SponsorPlacementWithContext) {
    setEditingId(p.id);
    setEditForm({
      // Fall back to org profile data if the placement hasn't been customised yet
      logo_url: p.logo_url ?? orgLogoUrl ?? "",
      link_url: p.link_url ?? orgWebsite ?? "",
      display_order: String(p.display_order),
      start_date: p.start_date ?? "",
      end_date: p.end_date ?? "",
    });
    setError(null);
  }

  function handleToggle(p: SponsorPlacementWithContext) {
    startTransition(async () => {
      const result = await updateSponsorPlacement(p.id, { is_active: !p.is_active });
      if (result.success) {
        setPlacements((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: result.data.is_active } : x)));
        router.refresh();
      }
    });
  }

  function handleSaveEdit(id: string) {
    if (!editForm) return;
    startTransition(async () => {
      const result = await updateSponsorPlacement(id, {
        logo_url: editForm.logo_url.trim() || null,
        link_url: editForm.link_url.trim() || null,
        display_order: parseInt(editForm.display_order, 10) || 0,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
      });
      if (result.success) {
        setPlacements((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  logo_url: result.data.logo_url,
                  link_url: result.data.link_url,
                  display_order: result.data.display_order,
                  start_date: result.data.start_date,
                  end_date: result.data.end_date,
                }
              : x
          )
        );
        setEditingId(null);
        setEditForm(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    startTransition(async () => {
      const result = await deleteSponsorPlacement(id);
      if (result.success) {
        setPlacements((prev) => prev.filter((x) => x.id !== id));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleAddPlacement() {
    if (!newSlotId) { setError("Select a slot."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createSponsorPlacement({
        agreement_id: agreementId,
        slot_id: newSlotId,
        // Pre-seed from org profile — admin can override
        logo_url: orgLogoUrl ?? null,
        link_url: orgWebsite ?? null,
        config_json: {},
        display_order: placements.length,
        start_date: null,
        end_date: null,
        is_active: true,
      });
      if (result.success) {
        // Refresh to get the joined slot data
        setShowAdd(false);
        setNewSlotId("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Placements</p>
        {unusedSlots.length > 0 && !showAdd && (
          <button
            onClick={() => { setShowAdd(true); setError(null); }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            + Add placement
          </button>
        )}
      </div>

      {/* Add placement form */}
      {showAdd && (
        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 flex items-center gap-3">
          <select
            value={newSlotId}
            onChange={(e) => setNewSlotId(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
          >
            <option value="">Select a slot…</option>
            {unusedSlots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.location})
              </option>
            ))}
          </select>
          <button
            onClick={handleAddPlacement}
            disabled={isPending}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setShowAdd(false); setError(null); }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-white"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {placements.length === 0 && !showAdd ? (
        <p className="text-sm text-gray-400 py-3">
          No placements yet. Activate the agreement to auto-provision placements from the tier, or add them manually.
        </p>
      ) : (
        <div className="space-y-2">
          {placements
            .sort((a, b) => a.display_order - b.display_order)
            .map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border ${
                  p.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"
                }`}
              >
                {editingId === p.id && editForm ? (
                  <div className="p-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {p.slot?.label}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL</label>
                        <input
                          type="url"
                          value={editForm.logo_url}
                          onChange={(e) => setEditForm((f) => f ? { ...f, logo_url: e.target.value } : f)}
                          placeholder="https://…"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Link URL</label>
                        <input
                          type="url"
                          value={editForm.link_url}
                          onChange={(e) => setEditForm((f) => f ? { ...f, link_url: e.target.value } : f)}
                          placeholder="https://…"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Start date override</label>
                        <input
                          type="date"
                          value={editForm.start_date}
                          onChange={(e) => setEditForm((f) => f ? { ...f, start_date: e.target.value } : f)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">End date override</label>
                        <input
                          type="date"
                          value={editForm.end_date}
                          onChange={(e) => setEditForm((f) => f ? { ...f, end_date: e.target.value } : f)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Display order</label>
                        <input
                          type="number"
                          value={editForm.display_order}
                          onChange={(e) => setEditForm((f) => f ? { ...f, display_order: e.target.value } : f)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(p.id)}
                        disabled={isPending}
                        className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditForm(null); }}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3">
                    {/* Logo preview */}
                    <div className="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden">
                      {p.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-gray-300 text-xs">Logo</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{p.slot?.label}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {p.slot?.location}
                        </span>
                        {!p.is_active && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">inactive</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {p.link_url || <span className="italic">No link set</span>}
                        {(p.start_date || p.end_date) && (
                          <span className="ml-2">
                            {p.start_date && `from ${p.start_date}`}
                            {p.end_date && ` to ${p.end_date}`}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(p)}
                        disabled={isPending}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                          p.is_active
                            ? "border-amber-200 text-amber-600 hover:bg-amber-50"
                            : "border-green-200 text-green-600 hover:bg-green-50"
                        }`}
                      >
                        {p.is_active ? "Hide" : "Show"}
                      </button>
                      {confirmDelete === p.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDelete(p.id)}
                            disabled={isPending}
                            className="px-2.5 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="px-2.5 py-1 text-xs rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
