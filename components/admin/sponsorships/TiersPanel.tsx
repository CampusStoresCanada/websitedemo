"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSponsorTier,
  updateSponsorTier,
  deleteSponsorTier,
} from "@/lib/actions/sponsorship";
import { BENEFIT_REGISTRY } from "@/lib/sponsorship/types";
import type { SponsorTier, BenefitConfig, TierIcon } from "@/lib/sponsorship/types";
import BenefitBuilder from "./BenefitBuilder";
import { TierIconPreview } from "@/components/sponsorship/SponsorTierBadge";
import SponsorTierBadge from "@/components/sponsorship/SponsorTierBadge";
import type { BenefitReferenceOptions } from "@/lib/actions/sponsorship";

const PRESET_COLORS = [
  { label: "Platinum", value: "#B5A642" },
  { label: "Gold",     value: "#B8860B" },
  { label: "Silver",   value: "#A8A9AD" },
  { label: "Bronze",   value: "#CD7F32" },
  { label: "Blue",     value: "#1e3a5f" },
  { label: "Red",      value: "#EE2A2E" },
];

interface TiersPanelProps {
  tiers: SponsorTier[];
  referenceOptions: BenefitReferenceOptions;
}

const TIER_ICONS: { key: TierIcon; label: string }[] = [
  { key: "award",  label: "Award"  },
  { key: "trophy", label: "Trophy" },
  { key: "shield", label: "Shield" },
];

interface TierFormState {
  name: string;
  slug: string;
  description: string;
  price_cents: string;
  color: string;
  icon: TierIcon | null;
  display_order: string;
  max_sponsors: string;
  benefits: BenefitConfig[];
}

function blankForm(order = 0): TierFormState {
  return {
    name: "",
    slug: "",
    description: "",
    price_cents: "",
    color: "#B8860B",
    icon: null,
    display_order: String(order),
    max_sponsors: "",
    benefits: [],
  };
}

function tierToForm(t: SponsorTier): TierFormState {
  return {
    name: t.name,
    slug: t.slug,
    description: t.description ?? "",
    price_cents: t.price_cents != null ? String(t.price_cents / 100) : "",
    color: t.color ?? "#B8860B",
    icon: t.icon ?? null,
    display_order: String(t.display_order),
    max_sponsors: t.max_sponsors != null ? String(t.max_sponsors) : "",
    benefits: t.benefits ?? [],
  };
}

function autoSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function TiersPanel({ tiers: initial, referenceOptions }: TiersPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tiers, setTiers] = useState(initial);
  const [showInactive, setShowInactive] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<TierFormState>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const visible = showInactive ? tiers : tiers.filter((t) => t.is_active);

  function patchForm(patch: Partial<TierFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function buildPayload(f: TierFormState) {
    return {
      name: f.name.trim(),
      slug: f.slug.trim() || autoSlug(f.name),
      description: f.description.trim() || null,
      price_cents: f.price_cents ? Math.round(parseFloat(f.price_cents) * 100) : null,
      color: f.color || null,
      icon: f.icon,
      display_order: parseInt(f.display_order, 10) || 0,
      is_active: true,
      max_sponsors: f.max_sponsors ? parseInt(f.max_sponsors, 10) : null,
      benefits: f.benefits,
    };
  }

  function handleCreate() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createSponsorTier(buildPayload(form));
      if (result.success) {
        setTiers((prev) => [...prev, result.data]);
        setShowNew(false);
        setForm(blankForm(tiers.length + 1));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleUpdate(id: string) {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await updateSponsorTier(id, buildPayload(form));
      if (result.success) {
        setTiers((prev) => prev.map((t) => (t.id === id ? result.data : t)));
        setEditingId(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleToggleActive(tier: SponsorTier) {
    startTransition(async () => {
      const result = await updateSponsorTier(tier.id, { is_active: !tier.is_active });
      if (result.success) {
        setTiers((prev) => prev.map((t) => (t.id === tier.id ? result.data : t)));
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    startTransition(async () => {
      const result = await deleteSponsorTier(id);
      if (result.success) {
        setTiers((prev) => prev.filter((t) => t.id !== id));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function startEdit(tier: SponsorTier) {
    setEditingId(tier.id);
    setForm(tierToForm(tier));
    setShowNew(false);
    setExpandedId(null);
    setError(null);
  }

  const TierForm = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
    <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => {
              patchForm({
                name: e.target.value,
                slug: editingId ? form.slug : autoSlug(e.target.value),
              });
            }}
            placeholder="Platinum"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => patchForm({ slug: e.target.value })}
            placeholder="platinum"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Price (CAD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={form.price_cents}
              onChange={(e) => patchForm({ price_cents: e.target.value })}
              placeholder="20000"
              className="w-full rounded-lg border border-gray-300 pl-7 pr-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Max sponsors</label>
          <input
            type="number"
            min={1}
            value={form.max_sponsors}
            onChange={(e) => patchForm({ max_sponsors: e.target.value })}
            placeholder="Unlimited"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {/* Visual picker */}
              <input
                type="color"
                value={form.color}
                onChange={(e) => patchForm({ color: e.target.value })}
                className="h-9 w-12 rounded border border-gray-300 cursor-pointer shrink-0"
              />
              {/* Hex text input — syncs bidirectionally */}
              <input
                type="text"
                value={form.color}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const hex = raw.startsWith("#") ? raw : `#${raw}`;
                  // Only update picker when we have a valid 3 or 6-digit hex
                  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
                    patchForm({ color: hex });
                  } else {
                    // Let the user keep typing without clamping
                    patchForm({ color: raw });
                  }
                }}
                placeholder="#B8860B"
                maxLength={7}
                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
              {/* Live swatch */}
              <div
                className="w-8 h-8 rounded-lg border border-gray-200 shadow-inner shrink-0"
                style={{ backgroundColor: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(form.color) ? form.color : "#ccc" }}
              />
            </div>
            {/* Preset swatches */}
            <div className="flex gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  title={`${c.label} ${c.value}`}
                  onClick={() => patchForm({ color: c.value })}
                  className="w-6 h-6 rounded-full border border-white shadow-sm ring-1 ring-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Display order</label>
          <input
            type="number"
            min={0}
            value={form.display_order}
            onChange={(e) => patchForm({ display_order: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
        </div>
      </div>

      {/* Icon picker — live previews in current tier color */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Icon</label>
        <div className="flex gap-3">
          {TIER_ICONS.map(({ key, label }) => {
            const selected = form.icon === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => patchForm({ icon: selected ? null : key })}
                className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border-2 transition-all ${
                  selected
                    ? "border-accent bg-red-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <TierIconPreview
                  icon={key}
                  color={/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(form.color) ? form.color : "#B8860B"}
                  size={44}
                />
                <span className={`text-xs font-medium ${selected ? "text-accent" : "text-gray-500"}`}>
                  {label}
                </span>
              </button>
            );
          })}
          {form.icon !== null && (
            <button
              type="button"
              onClick={() => patchForm({ icon: null })}
              className="self-center ml-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          rows={2}
          value={form.description}
          onChange={(e) => patchForm({ description: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Benefits</label>
        <BenefitBuilder
          benefits={form.benefits}
          onChange={(benefits) => patchForm({ benefits })}
          referenceOptions={referenceOptions}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={isPending}
          className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving…" : "Save Tier"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show inactive tiers
        </label>
        {!showNew && (
          <button
            onClick={() => { setShowNew(true); setEditingId(null); setForm(blankForm(tiers.length + 1)); setError(null); }}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
          >
            + New Tier
          </button>
        )}
      </div>

      {/* New tier form */}
      {showNew && (
        <TierForm
          onSave={handleCreate}
          onCancel={() => { setShowNew(false); setError(null); }}
        />
      )}

      {/* Tier list */}
      {visible.length === 0 && !showNew && (
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No tiers yet</p>
          <p className="text-sm mt-1">Create your first sponsorship tier above.</p>
        </div>
      )}

      {visible.map((tier) => (
        <div key={tier.id} className={`rounded-xl border ${tier.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"}`}>
          {editingId === tier.id ? (
            <div className="p-4">
              <TierForm
                onSave={() => handleUpdate(tier.id)}
                onCancel={() => { setEditingId(null); setError(null); }}
              />
            </div>
          ) : (
            <>
              {/* Tier row */}
              <div className="flex items-center gap-4 p-4">
                {/* Icon badge or color chip fallback */}
                {tier.icon ? (
                  <SponsorTierBadge
                    icon={tier.icon}
                    color={tier.color ?? "#888"}
                    size={36}
                  />
                ) : (
                  <div
                    className="w-9 h-9 rounded-lg shrink-0 shadow-sm ring-1 ring-black/10"
                    style={{ backgroundColor: tier.color ?? "#ccc" }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{tier.name}</p>
                    <span className="font-mono text-xs text-gray-400">{tier.slug}</span>
                    {!tier.is_active && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-3">
                    {tier.price_cents != null && (
                      <span className="font-medium text-gray-700">
                        ${(tier.price_cents / 100).toLocaleString("en-CA")}
                      </span>
                    )}
                    {tier.max_sponsors != null ? (
                      <span>{tier.max_sponsors} slot{tier.max_sponsors !== 1 ? "s" : ""}</span>
                    ) : (
                      <span>Unlimited slots</span>
                    )}
                    <span>{tier.benefits.length} benefit{tier.benefits.length !== 1 ? "s" : ""}</span>
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === tier.id ? null : tier.id)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {expandedId === tier.id ? "Hide benefits" : "Benefits"}
                  </button>
                  <button
                    onClick={() => startEdit(tier)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(tier)}
                    disabled={isPending}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                      tier.is_active
                        ? "border-amber-200 text-amber-600 hover:bg-amber-50"
                        : "border-green-200 text-green-600 hover:bg-green-50"
                    }`}
                  >
                    {tier.is_active ? "Deactivate" : "Activate"}
                  </button>
                  {confirmDelete === tier.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(tier.id)}
                        disabled={isPending}
                        className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Confirm delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDelete(tier.id)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded benefits */}
              {expandedId === tier.id && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                  {tier.benefits.length === 0 ? (
                    <p className="text-sm text-gray-400">No benefits configured.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(
                        tier.benefits.reduce((acc, b) => {
                          const cat = BENEFIT_REGISTRY[b.key as keyof typeof BENEFIT_REGISTRY]?.category ?? "other";
                          if (!acc[cat]) acc[cat] = [];
                          acc[cat].push(b);
                          return acc;
                        }, {} as Record<string, typeof tier.benefits>)
                      ).map(([cat, items]) => (
                        <div key={cat}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 mt-2">
                            {cat}
                          </p>
                          {items.map((b) => (
                            <div key={b.key} className="flex items-center gap-2 text-sm py-1">
                              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                              <span className="text-gray-700">{b.label || BENEFIT_REGISTRY[b.key as keyof typeof BENEFIT_REGISTRY]?.label || b.key}</span>
                              {b.config?.count != null && (
                                <span className="text-xs text-gray-400">× {b.config.count}</span>
                              )}
                              {b.config?.reference_id && (
                                <span className="font-mono text-xs text-gray-400 truncate max-w-xs">
                                  → {b.config.reference_id as string}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
