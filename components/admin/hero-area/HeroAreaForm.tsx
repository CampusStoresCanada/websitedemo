"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import StringArrayEditor from "@/components/admin/shared/StringArrayEditor";
import {
  updateHeroCycleInterval,
  updateHeroSlideKindSettings,
  updateConferenceSlideContent,
} from "@/lib/actions/hero-settings";
import { HERO_KINDS, type HeroAreaSettings, type HeroKind, type HeroKindSetting } from "@/lib/hero-kinds";

const KIND_LABELS: Record<HeroKind, string> = {
  story: "Story (local community cards)",
  conference: "Conference",
  personalized: "Personalized matches",
  newest_org: "Newest member/partner",
  sponsor: "Sponsors",
};

interface ConferenceContent {
  title: string;
  statValue: string;
  statLabel: string;
  includedItems: string[];
  ctaTemplates: { admin: string; partner: string; member: string };
}

interface PricingPreview {
  boothPriceLabel: string | null;
  memberRegistrationPriceLabel: string | null;
}

/** Mirrors the {price} substitution fetchConferencePin() does server-side, for a live preview as the admin edits the template. */
function previewCta(template: string, priceLabel: string | null): string {
  if (!template) return "";
  if (priceLabel != null) return template.replace("{price}", priceLabel);
  return template.replace(" starting at {price}", "").replace(" starting from {price}", "");
}

export default function HeroAreaForm({
  heroSettings,
  conferenceContent,
  pricingPreview,
}: {
  heroSettings: HeroAreaSettings;
  conferenceContent: ConferenceContent;
  pricingPreview: PricingPreview | null;
}) {
  const router = useRouter();

  // --- Rotation section ---
  const [intervalSeconds, setIntervalSeconds] = useState(Math.round(heroSettings.cycleIntervalMs / 1000));
  const [kinds, setKinds] = useState<Record<HeroKind, HeroKindSetting>>(heroSettings.kinds);
  const [rotationSaving, startRotationSave] = useTransition();
  const [rotationSaved, setRotationSaved] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);

  function updateKind(kind: HeroKind, patch: Partial<HeroKindSetting>) {
    setKinds((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }

  function saveRotation() {
    setRotationError(null);
    startRotationSave(async () => {
      const intervalResult = await updateHeroCycleInterval(intervalSeconds * 1000);
      if (!intervalResult.success) {
        setRotationError(intervalResult.error ?? "Failed to save interval");
        return;
      }
      const kindResults = await Promise.all(
        HERO_KINDS.map((kind) => updateHeroSlideKindSettings(kind, kinds[kind]))
      );
      const failed = kindResults.find((r) => !r.success);
      if (failed) {
        setRotationError(failed.error ?? "Failed to save a slide kind");
        return;
      }
      setRotationSaved(true);
      setTimeout(() => setRotationSaved(false), 2000);
      router.refresh();
    });
  }

  // --- Conference content section ---
  const [title, setTitle] = useState(conferenceContent.title);
  const [statValue, setStatValue] = useState(conferenceContent.statValue);
  const [statLabel, setStatLabel] = useState(conferenceContent.statLabel);
  const [includedItems, setIncludedItems] = useState(conferenceContent.includedItems);
  const [ctaAdmin, setCtaAdmin] = useState(conferenceContent.ctaTemplates.admin);
  const [ctaPartner, setCtaPartner] = useState(conferenceContent.ctaTemplates.partner);
  const [ctaMember, setCtaMember] = useState(conferenceContent.ctaTemplates.member);
  const [contentSaving, startContentSave] = useTransition();
  const [contentSaved, setContentSaved] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  function saveConferenceContent() {
    setContentError(null);
    startContentSave(async () => {
      const result = await updateConferenceSlideContent({
        title,
        statValue,
        statLabel,
        includedItems,
        ctaTemplates: { admin: ctaAdmin, partner: ctaPartner, member: ctaMember },
      });
      if (!result.success) {
        setContentError(result.error ?? "Failed to save");
        return;
      }
      setContentSaved(true);
      setTimeout(() => setContentSaved(false), 2000);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Rotation */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Rotation</h2>
        <p className="text-xs text-gray-400 mb-4">
          How long each slide stays up, and how often each kind is picked. Story cards are real
          org highlights; the other four only show when there's real data for the viewer.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Seconds per slide
          </label>
          <input
            type="number"
            min={3}
            max={60}
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(parseInt(e.target.value, 10) || 9)}
            className="w-20 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-center focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
          />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
              <th className="pb-2 font-medium">Kind</th>
              <th className="pb-2 font-medium w-24">Enabled</th>
              <th className="pb-2 font-medium w-24">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {HERO_KINDS.map((kind) => (
              <tr key={kind}>
                <td className="py-2 text-gray-800">{KIND_LABELS[kind]}</td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={kinds[kind].enabled}
                    onChange={(e) => updateKind(kind, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                  />
                </td>
                <td className="py-2">
                  <input
                    type="number"
                    min={0}
                    value={kinds[kind].weight}
                    onChange={(e) => updateKind(kind, { weight: parseInt(e.target.value, 10) || 0 })}
                    className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm text-center focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rotationError && <p className="mt-3 text-sm text-red-500">{rotationError}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveRotation}
            disabled={rotationSaving}
            className="rounded-md bg-[#EE2A2E] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#D92327] disabled:opacity-50 transition-colors"
          >
            {rotationSaving ? "Saving…" : "Save Rotation"}
          </button>
          {rotationSaved && <span className="text-sm text-green-600 font-medium">Saved ✓</span>}
        </div>
      </div>

      {/* Conference content */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Conference Content</h2>
        <p className="text-xs text-gray-400 mb-4">
          The conference slide's headline, "By the Numbers" stat, and included-items list.
          Dates, venue, and prices are always live — nothing to edit here for those.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Headline</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stat value</label>
              <input
                type="text"
                value={statValue}
                onChange={(e) => setStatValue(e.target.value)}
                placeholder="8"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stat label</label>
              <input
                type="text"
                value={statLabel}
                onChange={(e) => setStatLabel(e.target.value)}
                placeholder="Expert Sessions"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">What's included</label>
            <StringArrayEditor items={includedItems} onChange={setIncludedItems} disabled={contentSaving} />
          </div>

          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">
              CTA templates — use <code className="bg-gray-100 px-1 rounded">{"{price}"}</code> where the live price should appear.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Super Admin</label>
                <input
                  type="text"
                  value={ctaAdmin}
                  onChange={(e) => setCtaAdmin(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Partner org — preview: <span className="text-gray-700 font-medium">{previewCta(ctaPartner, pricingPreview?.boothPriceLabel ?? null)}</span>
                </label>
                <input
                  type="text"
                  value={ctaPartner}
                  onChange={(e) => setCtaPartner(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Member org / public — preview: <span className="text-gray-700 font-medium">{previewCta(ctaMember, pricingPreview?.memberRegistrationPriceLabel ?? null)}</span>
                </label>
                <input
                  type="text"
                  value={ctaMember}
                  onChange={(e) => setCtaMember(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
                />
              </div>
            </div>

            {!pricingPreview && (
              <p className="mt-2 text-xs text-amber-600">
                No conference with real pricing found right now — previews will show without a price.
              </p>
            )}
          </div>
        </div>

        {contentError && <p className="mt-3 text-sm text-red-500">{contentError}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveConferenceContent}
            disabled={contentSaving}
            className="rounded-md bg-[#EE2A2E] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#D92327] disabled:opacity-50 transition-colors"
          >
            {contentSaving ? "Saving…" : "Save Content"}
          </button>
          {contentSaved && <span className="text-sm text-green-600 font-medium">Saved ✓</span>}
        </div>
      </div>
    </div>
  );
}
