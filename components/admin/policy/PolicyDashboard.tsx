"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { PolicySet, PolicyValue, PolicyCategory } from "@/lib/policy/types";
import { POLICY_CATEGORIES } from "@/lib/policy/types";
import {
  createPolicyDraft,
  discardDraft,
  seedMissingBillingPolicies,
} from "@/lib/actions/policy";
import type { PlatformConfig, PlatformFeature } from "@/lib/actions/platform";
import { FEATURE_POLICY_CATEGORIES } from "@/lib/actions/platform";
import PolicyTab from "./PolicyTab";
import PolicyPublishFlow from "./PolicyPublishFlow";
import PolicyVersionHistory from "./PolicyVersionHistory";
import PricingPreviewPanel from "./PricingPreviewPanel";
import PlatformFeaturesTab from "./PlatformFeaturesTab";
import PlatformIdentityEditor from "./PlatformIdentityEditor";

const CATEGORY_LABELS: Record<PolicyCategory, string> = {
  renewals: "Renewals",
  billing: "Billing / Pricing",
  scheduling: "Scheduling",
  visibility: "Visibility",
  integrations: "Integrations",
  retention: "Retention / Legal",
  admin: "Admin",
};

type TabKey = PolicyCategory | "platform";

interface Props {
  activeSet: PolicySet | null;
  draft: PolicySet | null;
  activeValues: PolicyValue[];
  draftValues: PolicyValue[];
  isSuperAdmin: boolean;
  features?: PlatformFeature[];
  platformConfig?: PlatformConfig | null;
}

export default function PolicyDashboard({
  activeSet,
  draft,
  activeValues,
  draftValues,
  isSuperAdmin,
  features = [],
  platformConfig,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("platform");
  const [showHistory, setShowHistory] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filter policy categories based on enabled features
  const enabledCategorySet = useMemo(() => {
    if (features.length === 0) return new Set(POLICY_CATEGORIES);
    const cats = new Set<string>();
    // Always include retention — it spans features
    cats.add("retention");
    for (const f of features) {
      if (!f.enabled) continue;
      const mapped = FEATURE_POLICY_CATEGORIES[f.feature_key as keyof typeof FEATURE_POLICY_CATEGORIES];
      if (mapped) {
        for (const cat of mapped) cats.add(cat);
      }
    }
    return cats;
  }, [features]);

  const visibleCategories = POLICY_CATEGORIES.filter(
    (cat) => enabledCategorySet.has(cat)
  );

  const isEditing = !!draft;
  const displayValues = isEditing ? draftValues : activeValues;
  const tabValues = activeTab === "platform" ? [] : displayValues.filter((v) => v.category === activeTab);
  const billingValues = displayValues.filter((v) => v.category === "billing");
  const missingBilling = activeTab === "billing" && billingValues.length === 0;

  async function handleCreateDraft() {
    try {
      setError(null);
      setLoading(true);
      const result = await createPolicyDraft(
        `Draft ${new Date().toLocaleDateString("en-CA")}`
      );
      if (!result.success) {
        setError(result.error ?? "Failed to create draft");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create draft failed unexpectedly");
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscardDraft() {
    if (!draft) return;
    if (!confirm("Discard this draft? All changes will be lost.")) return;
    try {
      setError(null);
      setLoading(true);
      const result = await discardDraft(draft.id);
      if (!result.success) {
        setError(result.error ?? "Failed to discard draft");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discard draft failed unexpectedly");
    } finally {
      setLoading(false);
    }
  }

  async function handleSeedBillingKeys() {
    if (!draft) return;
    try {
      setError(null);
      setLoading(true);
      const result = await seedMissingBillingPolicies(draft.id);
      if (!result.success) {
        setError(result.error ?? "Failed to seed billing policies");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing seed failed unexpectedly");
    } finally {
      setLoading(false);
    }
  }

  if (showHistory) {
    return (
      <div>
        <button
          onClick={() => setShowHistory(false)}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 flex items-center gap-1"
        >
          &larr; Back to Policy Settings
        </button>
        <PolicyVersionHistory isSuperAdmin={isSuperAdmin} />
      </div>
    );
  }

  if (showPublish && draft && activeSet) {
    return (
      <div>
        <button
          onClick={() => setShowPublish(false)}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 flex items-center gap-1"
        >
          &larr; Back to Draft
        </button>
        <PolicyPublishFlow
          draft={draft}
          activeSetId={activeSet.id}
          onPublished={() => {
            setShowPublish(false);
            router.refresh();
          }}
          onCancel={() => setShowPublish(false)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Policy Settings
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {activeSet
              ? `Active: ${activeSet.name}`
              : "No active policy set"}
            {activeSet?.published_at &&
              ` — published ${new Date(activeSet.published_at).toLocaleDateString("en-CA")}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
          >
            Version History
          </button>
          {!isEditing && (
            <button
              onClick={handleCreateDraft}
              disabled={loading}
              className="px-4 py-1.5 text-sm bg-[var(--text-primary)] text-white rounded-[var(--radius-md)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Draft"}
            </button>
          )}
        </div>
      </div>

      {/* Draft banner */}
      {isEditing && draft && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-[var(--radius-md)] flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-amber-800">
              Editing Draft: {draft.name}
            </span>
            <span className="text-xs text-amber-600 ml-2">
              Created{" "}
              {new Date(draft.created_at).toLocaleDateString("en-CA")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <button
                onClick={handleDiscardDraft}
                disabled={loading}
                className="px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded-[var(--radius-md)] hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Discard
              </button>
            )}
            {isSuperAdmin && (
              <button
                onClick={() => setShowPublish(true)}
                className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-[var(--radius-md)] hover:bg-green-700 transition-colors"
              >
                Review & Publish
              </button>
            )}
            {!isSuperAdmin && (
              <span className="text-xs text-amber-600">
                Only super admins can publish
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-[var(--radius-lg)] w-fit flex-wrap">
        <button
          onClick={() => setActiveTab("platform")}
          className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors whitespace-nowrap ${
            activeTab === "platform"
              ? "bg-white text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Platform
        </button>
        {visibleCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors whitespace-nowrap ${
              activeTab === cat
                ? "bg-white text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "platform" && (
        <div className="space-y-8">
          {platformConfig && (
            <PlatformIdentityEditor config={platformConfig} isSuperAdmin={isSuperAdmin} />
          )}
          <PlatformFeaturesTab features={features} isSuperAdmin={isSuperAdmin} />
        </div>
      )}
      {activeTab !== "platform" && (
        <>
          {activeTab === "billing" && isEditing && draft ? (
            <div className="space-y-3">
              {missingBilling ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-md)] text-sm text-amber-800 flex items-center justify-between gap-3">
                  <span>
                    No billing policy rows exist in this draft yet. Seed defaults to
                    enable billing/pricing configuration.
                  </span>
                  <button
                    onClick={handleSeedBillingKeys}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-[var(--radius-md)] hover:bg-amber-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? "Seeding..." : "Seed Billing Keys"}
                  </button>
                </div>
              ) : null}
              <PricingPreviewPanel draftSetId={draft.id} isSuperAdmin={isSuperAdmin} />
            </div>
          ) : null}
          <PolicyTab
            values={tabValues}
            publishedValues={activeValues.filter((v) => v.category === activeTab)}
            isEditing={isEditing}
            draftSetId={draft?.id ?? null}
          />
        </>
      )}
    </div>
  );
}
