"use client";

import { BENEFIT_REGISTRY, BENEFIT_KEYS } from "@/lib/sponsorship/types";
import type { BenefitConfig, BenefitKey } from "@/lib/sponsorship/types";
import type { BenefitReferenceOptions } from "@/lib/actions/sponsorship";

const CATEGORY_LABELS = {
  website:    "Website",
  report:     "Reports",
  circle:     "Circle",
  conference: "Conference",
  email:      "Email",
} as const;

const CATEGORY_ORDER: Array<keyof typeof CATEGORY_LABELS> = [
  "website", "report", "circle", "conference", "email",
];

// Which reference list each conference benefit key pulls from
const REFERENCE_SOURCE: Partial<Record<BenefitKey, keyof BenefitReferenceOptions>> = {
  conference_exhibitor:     "conferenceInstances",
  conference_travel_host:   "conferenceInstances",
  // The conference's own offsite events (Meet & Greet Reception, Tuesday/Wednesday
  // Offsite, etc.) live in the v3 catalog as programItems, not the general `events`
  // table — that table is for site-wide events unrelated to a specific conference.
  conference_offsite_host:  "programItems",
  conference_speaking_slot: "programItems",
};

interface BenefitBuilderProps {
  benefits: BenefitConfig[];
  onChange: (benefits: BenefitConfig[]) => void;
  referenceOptions: BenefitReferenceOptions;
}

export default function BenefitBuilder({ benefits, onChange, referenceOptions }: BenefitBuilderProps) {
  const enabledKeys = new Set(benefits.map((b) => b.key));

  function toggle(key: BenefitKey, enabled: boolean) {
    if (enabled) {
      const def = BENEFIT_REGISTRY[key];
      const newBenefit: BenefitConfig = {
        key,
        label: def.label,
        config: {
          ...(def.hasCount ? { count: 1 } : {}),
          ...(def.hasReferenceId ? { reference_id: "" } : {}),
        },
      };
      onChange([...benefits, newBenefit]);
    } else {
      onChange(benefits.filter((b) => b.key !== key));
    }
  }

  function updateConfig(key: string, patch: Record<string, unknown>) {
    onChange(
      benefits.map((b) =>
        b.key === key ? { ...b, config: { ...b.config, ...patch } } : b
      )
    );
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    keys: BENEFIT_KEYS.filter((k) => BENEFIT_REGISTRY[k].category === cat),
  }));

  return (
    <div className="space-y-4">
      {grouped.map(({ category, label, keys }) => (
        <div key={category}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            {label}
          </p>
          <div className="space-y-1.5">
            {keys.map((key) => {
              const def = BENEFIT_REGISTRY[key];
              const enabled = enabledKeys.has(key);
              const benefit = benefits.find((b) => b.key === key);
              const refSource = REFERENCE_SOURCE[key];
              const refOptions = refSource ? referenceOptions[refSource] : null;

              return (
                <div
                  key={key}
                  className={`rounded-lg border px-3 py-2 transition-colors ${
                    enabled
                      ? "border-green-200 bg-green-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggle(key, e.target.checked)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-800">{def.label}</span>
                    <span className="ml-auto font-mono text-[10px] text-gray-400">{key}</span>
                  </label>

                  {enabled && (def.hasCount || def.hasReferenceId) && (
                    <div className="mt-2 ml-6 flex flex-wrap gap-3">

                      {def.hasCount && (
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                          <span>Count:</span>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={(benefit?.config?.count as number) ?? 1}
                            onChange={(e) =>
                              updateConfig(key, { count: parseInt(e.target.value, 10) || 1 })
                            }
                            className="w-16 rounded border border-gray-300 px-2 py-0.5 text-xs"
                          />
                        </label>
                      )}

                      {def.hasReferenceId && (
                        refOptions && refOptions.length > 0 ? (
                          <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <span>Linked to:</span>
                            <select
                              value={(benefit?.config?.reference_id as string) ?? ""}
                              onChange={(e) => updateConfig(key, { reference_id: e.target.value })}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs bg-white min-w-48"
                            >
                              <option value="">— select —</option>
                              {refOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <span>Reference ID:</span>
                            <input
                              type="text"
                              value={(benefit?.config?.reference_id as string) ?? ""}
                              placeholder="UUID"
                              onChange={(e) => updateConfig(key, { reference_id: e.target.value })}
                              className="w-64 rounded border border-gray-300 px-2 py-0.5 text-xs font-mono"
                            />
                            <span className="text-gray-400 italic">
                              (no {refSource?.replace(/([A-Z])/g, " $1").toLowerCase()} found)
                            </span>
                          </label>
                        )
                      )}

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
