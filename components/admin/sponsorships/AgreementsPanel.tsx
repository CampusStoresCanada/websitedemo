"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSponsorAgreement } from "@/lib/actions/sponsorship";
import type {
  SponsorAgreementWithMeta,
  SponsorAgreementStatus,
  SponsorTier,
} from "@/lib/sponsorship/types";
import SponsorStatusBadge from "./SponsorStatusBadge";

// Status sub-filter — fixed set, always the same regardless of tier config
const STATUS_FILTERS: Array<{ value: SponsorAgreementStatus | "all"; label: string }> = [
  { value: "all",       label: "All" },
  { value: "active",    label: "Active" },
  { value: "draft",     label: "Draft" },
  { value: "expired",   label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

interface AgreementsPanelProps {
  agreements: SponsorAgreementWithMeta[];
  tiers: SponsorTier[];
  orgs: Array<{ id: string; name: string; slug: string; type: string }>;
}

interface NewAgreementForm {
  organization_id: string;
  tier_id: string;
  start_date: string;
  end_date: string;
  notes: string;
}

function blankForm(): NewAgreementForm {
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10);
  return { organization_id: "", tier_id: "", start_date: today, end_date: nextYear, notes: "" };
}

export default function AgreementsPanel({ agreements: initial, tiers, orgs }: AgreementsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [agreements, setAgreements] = useState(initial);
  const [activeTierFilter, setActiveTierFilter] = useState<string>("all"); // tier slug or "all"
  const [activeStatusFilter, setActiveStatusFilter] = useState<SponsorAgreementStatus | "all">("all");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewAgreementForm>(blankForm());
  const [error, setError] = useState<string | null>(null);

  function patchForm(patch: Partial<NewAgreementForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  const visible = agreements
    .filter((a) => activeTierFilter === "all" || a.tier?.slug === activeTierFilter)
    .filter((a) => activeStatusFilter === "all" || a.status === activeStatusFilter);

  function handleCreate() {
    if (!form.organization_id) { setError("Select an organization."); return; }
    if (!form.tier_id) { setError("Select a tier."); return; }
    if (!form.start_date || !form.end_date) { setError("Start and end dates are required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createSponsorAgreement({
        organization_id: form.organization_id,
        tier_id: form.tier_id,
        start_date: form.start_date,
        end_date: form.end_date,
        notes: form.notes || null,
        signed_doc_url: null,
        custom_benefits: [],
      });
      if (result.success) {
        // Refresh from server to get joined meta fields
        setShowNew(false);
        setForm(blankForm());
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const activeTiers = tiers.filter((t) => t.is_active);
  const activeCount = agreements.filter((a) => a.status === "active").length;
  const draftCount  = agreements.filter((a) => a.status === "draft").length;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      {(activeCount > 0 || draftCount > 0) && (
        <div className="flex gap-2">
          {activeCount > 0 && (
            <span className="px-3 py-1 rounded-full text-sm bg-green-50 text-green-700 border border-green-200">
              {activeCount} active sponsor{activeCount !== 1 ? "s" : ""}
            </span>
          )}
          {draftCount > 0 && (
            <span className="px-3 py-1 rounded-full text-sm bg-amber-50 text-amber-700 border border-amber-200">
              {draftCount} draft{draftCount !== 1 ? "s" : ""} pending
            </span>
          )}
        </div>
      )}

      {/* Header row */}
      <div className="space-y-3">
        {/* Tier tabs — driven from DB, automatically includes new tiers */}
        <div className="flex items-center justify-between">
          <div className="flex gap-0 border-b border-gray-200">
            {[{ slug: "all", name: "All Tiers", color: null }, ...activeTiers].map((t) => {
              const slug = "slug" in t ? t.slug : "all";
              const tierAgreements = slug === "all"
                ? agreements
                : agreements.filter((a) => a.tier?.slug === slug);
              const isActive = activeTierFilter === slug;
              return (
                <button
                  key={slug}
                  onClick={() => setActiveTierFilter(slug)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? "border-accent text-accent"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t.color && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                  )}
                  {t.name}
                  {tierAgreements.length > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                      {tierAgreements.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!showNew && (
            <button
              onClick={() => { setShowNew(true); setError(null); setForm(blankForm()); }}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
            >
              + New Agreement
            </button>
          )}
        </div>

        {/* Status sub-filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(({ value, label }) => {
            const tierFiltered = activeTierFilter === "all"
              ? agreements
              : agreements.filter((a) => a.tier?.slug === activeTierFilter);
            const count = value === "all" ? tierFiltered.length : tierFiltered.filter((a) => a.status === value).length;
            const isActive = activeStatusFilter === value;
            return (
              <button
                key={value}
                onClick={() => setActiveStatusFilter(value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-gray-800 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {label}
                {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* New agreement form */}
      {showNew && (
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-4">
          <p className="text-sm font-semibold text-gray-700">New Sponsor Agreement</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization *</label>
              <select
                value={form.organization_id}
                onChange={(e) => patchForm({ organization_id: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
              >
                <option value="">Select an organization…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tier *</label>
              <select
                value={form.tier_id}
                onChange={(e) => patchForm({ tier_id: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
              >
                <option value="">Select a tier…</option>
                {activeTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.price_cents != null ? `— $${(t.price_cents / 100).toLocaleString("en-CA")}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {/* spacer */ }
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start date *</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => patchForm({ start_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End date *</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => patchForm({ end_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
                placeholder="Internal notes about this agreement…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none"
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
              {isPending ? "Creating…" : "Create Agreement (Draft)"}
            </button>
            <button
              onClick={() => { setShowNew(false); setError(null); }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-400">Agreement starts in Draft. Activate it once signed to trigger placements and Circle provisioning.</p>
        </div>
      )}

      {/* Agreement list */}
      {visible.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No agreements{activeStatusFilter !== "all" ? ` with status "${activeStatusFilter}"` : ""}{activeTierFilter !== "all" ? ` for ${activeTierFilter}` : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((agreement) => {
            const tierColor = agreement.tier?.color ?? "#ccc";
            return (
              <Link
                key={agreement.id}
                href={`/admin/sponsorships/agreements/${agreement.id}`}
                className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all group"
              >
                {/* Tier color strip */}
                <div
                  className="w-1.5 self-stretch rounded-full shrink-0"
                  style={{ backgroundColor: tierColor }}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <SponsorStatusBadge status={agreement.status} />
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: tierColor }}
                    >
                      {agreement.tier?.name}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 group-hover:text-accent transition-colors truncate">
                    {agreement.organization?.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {agreement.start_date} → {agreement.end_date}
                  </p>
                </div>

                <div className="shrink-0 text-gray-300 group-hover:text-gray-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
