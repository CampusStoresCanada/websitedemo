"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseUTC } from "@/lib/utils";
import type { PlatformFeature, PlatformFeatureKey } from "@/lib/actions/platform-types";
import {
  PLATFORM_FEATURE_KEYS,
  PLATFORM_FEATURE_LABELS,
  PLATFORM_FEATURE_DESCRIPTIONS,
} from "@/lib/actions/platform-types";
import { updatePlatformFeature } from "@/lib/actions/platform";

interface Props {
  features: PlatformFeature[];
  isSuperAdmin: boolean;
}

export default function PlatformFeaturesTab({ features, isSuperAdmin }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(key: PlatformFeatureKey, enabled: boolean) {
    setError(null);
    setLoading(key);
    try {
      const result = await updatePlatformFeature(key, enabled);
      if (!result.success) {
        setError(result.error ?? "Failed to update feature.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Update failed unexpectedly"
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Enable or disable platform capabilities.
        Core features cannot be turned off.
        {!isSuperAdmin && " Only super admins can change feature settings."}
      </p>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {PLATFORM_FEATURE_KEYS.map((key) => {
          const feature = features.find((f) => f.feature_key === key);
          const enabled = feature?.enabled ?? false;
          const alwaysOn = feature?.always_on ?? false;
          const isLoading = loading === key;

          return (
            <div
              key={key}
              className={`flex items-center justify-between p-3 rounded-[var(--radius-md)] border transition-colors ${
                enabled
                  ? "border-blue-200 bg-blue-50/30"
                  : "border-[var(--border-default)]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {PLATFORM_FEATURE_LABELS[key]}
                  </span>
                  {alwaysOn && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-[var(--text-tertiary)]">
                      Core
                    </span>
                  )}
                  {enabled && !alwaysOn && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                      Enabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {PLATFORM_FEATURE_DESCRIPTIONS[key]}
                </p>
                {feature?.enabled_at && !alwaysOn && (
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                    Enabled{" "}
                    {parseUTC(feature.enabled_at).toLocaleDateString("en-CA")}
                  </p>
                )}
              </div>

              <div className="ml-4 flex-shrink-0">
                {alwaysOn ? (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Always on
                  </span>
                ) : (
                  <button
                    onClick={() => handleToggle(key, !enabled)}
                    disabled={!isSuperAdmin || isLoading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      enabled ? "bg-blue-600" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
