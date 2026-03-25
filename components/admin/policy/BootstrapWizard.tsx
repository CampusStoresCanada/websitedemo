"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { PolicyValue } from "@/lib/policy/types";
import type { PlatformFeature, PlatformFeatureKey } from "@/lib/actions/platform-types";
import {
  PLATFORM_FEATURE_KEYS,
  PLATFORM_FEATURE_LABELS,
  PLATFORM_FEATURE_DESCRIPTIONS,
  FEATURE_POLICY_CATEGORIES,
} from "@/lib/actions/platform-types";
import {
  savePlatformIdentity,
  savePlatformFeatures,
  completeBootstrap,
} from "@/lib/actions/platform";
import {
  createPolicyDraft,
  publishDraft,
} from "@/lib/actions/policy";
import PolicyTab from "./PolicyTab";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Props {
  features: PlatformFeature[];
  hasPolicySet: boolean;
}

interface IdentityForm {
  client_name: string;
  client_short_name: string;
  client_domain: string;
  support_email: string;
  logo_url: string;
  primary_color: string;
}

type WizardStep = "identity" | "features" | "config" | "review";
const STEPS: WizardStep[] = ["identity", "features", "config", "review"];
const STEP_LABELS: Record<WizardStep, string> = {
  identity: "Client Identity",
  features: "Platform Features",
  config: "Initial Configuration",
  review: "Review & Activate",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export default function BootstrapWizard({ features, hasPolicySet }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("identity");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Step 1: Identity
  const [identity, setIdentity] = useState<IdentityForm>({
    client_name: "",
    client_short_name: "",
    client_domain: "",
    support_email: "",
    logo_url: "",
    primary_color: "#1e3a5f",
  });

  // Step 2: Feature toggles
  const [featureState, setFeatureState] = useState<
    Record<PlatformFeatureKey, boolean>
  >(() => {
    const map: Record<string, boolean> = {};
    for (const f of features) {
      map[f.feature_key] = f.enabled;
    }
    // Ensure all keys present
    for (const key of PLATFORM_FEATURE_KEYS) {
      if (!(key in map)) map[key] = false;
    }
    return map as Record<PlatformFeatureKey, boolean>;
  });

  // Step 3: Policy draft values (loaded after draft creation)
  const [draftSetId, setDraftSetId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<PolicyValue[]>([]);
  const [configTab, setConfigTab] = useState<string | null>(null);

  // Derived: which policy categories are relevant based on enabled features
  const enabledCategories = useMemo(() => {
    const cats = new Set<string>();
    // Always include retention since it spans features
    cats.add("retention");
    for (const key of PLATFORM_FEATURE_KEYS) {
      if (featureState[key]) {
        for (const cat of FEATURE_POLICY_CATEGORIES[key]) {
          cats.add(cat);
        }
      }
    }
    return Array.from(cats);
  }, [featureState]);

  // Derived: feature rows with metadata
  const featureRows = useMemo(() => {
    return PLATFORM_FEATURE_KEYS.map((key) => {
      const row = features.find((f) => f.feature_key === key);
      return {
        key,
        label: PLATFORM_FEATURE_LABELS[key],
        description: PLATFORM_FEATURE_DESCRIPTIONS[key],
        alwaysOn: row?.always_on ?? false,
        enabled: featureState[key],
      };
    });
  }, [features, featureState]);

  const stepIndex = STEPS.indexOf(step);

  // ─── Validation ──────────────────────────────────────────────

  function validateIdentity(): string | null {
    if (!identity.client_name.trim()) return "Client name is required.";
    if (!identity.client_short_name.trim()) return "Short name is required.";
    if (!identity.support_email.trim()) return "Support email is required.";
    if (
      !identity.support_email.includes("@") ||
      !identity.support_email.includes(".")
    )
      return "Please enter a valid support email.";
    return null;
  }

  // ─── Step navigation ─────────────────────────────────────────

  async function handleNext() {
    setError(null);

    if (step === "identity") {
      const err = validateIdentity();
      if (err) {
        setError(err);
        return;
      }
      // Save identity
      setLoading(true);
      try {
        const result = await savePlatformIdentity({
          client_name: identity.client_name,
          client_short_name: identity.client_short_name,
          client_domain: identity.client_domain,
          support_email: identity.support_email,
          logo_url: identity.logo_url || null,
          primary_color: identity.primary_color,
        });
        if (!result.success) {
          setError(result.error ?? "Failed to save identity.");
          return;
        }
      } finally {
        setLoading(false);
      }
      setStep("features");
    } else if (step === "features") {
      // Save feature selections
      setLoading(true);
      try {
        const payload = PLATFORM_FEATURE_KEYS.map((key) => ({
          feature_key: key,
          enabled: featureState[key],
        }));
        const result = await savePlatformFeatures(payload);
        if (!result.success) {
          setError(result.error ?? "Failed to save features.");
          return;
        }

        // Create a policy draft if one doesn't exist and no active set exists
        if (!hasPolicySet && !draftSetId) {
          const draftResult = await createPolicyDraft("Bootstrap Initial Setup");
          if (!draftResult.success) {
            setError(draftResult.error ?? "Failed to create policy draft.");
            return;
          }
          if (draftResult.data) {
            setDraftSetId(draftResult.data.id);
            // Fetch draft values
            await loadDraftValues(draftResult.data.id);
          }
        }
      } finally {
        setLoading(false);
      }
      // Set initial config tab to first enabled category
      if (enabledCategories.length > 0) {
        setConfigTab(enabledCategories[0]);
      }
      setStep("config");
    } else if (step === "config") {
      setStep("review");
    }
  }

  function handleBack() {
    setError(null);
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function loadDraftValues(setId: string) {
    // We need to refetch draft values from the server.
    // Use a simple fetch to the policy dashboard data endpoint.
    // For now, trigger a router refresh and use what comes back.
    // This is a simplified approach — the draft values will be loaded
    // on the next render via the page server component.
    router.refresh();
  }

  // ─── Step 4: Activate ────────────────────────────────────────

  async function handleActivate() {
    setError(null);
    setLoading(true);
    try {
      // Publish the policy draft (immediate, no scheduled date)
      if (draftSetId) {
        const pubResult = await publishDraft(draftSetId, null, {});
        if (!pubResult.success) {
          setError(pubResult.error ?? "Failed to publish initial policy set.");
          return;
        }
      }

      // Mark bootstrap complete
      const result = await completeBootstrap();
      if (!result.success) {
        setError(result.error ?? "Failed to complete bootstrap.");
        return;
      }

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Platform Setup
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Configure your platform instance for the first time.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => {
                // Only allow going back to completed steps
                if (i < stepIndex) setStep(s);
              }}
              disabled={i > stepIndex}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                s === step
                  ? "bg-[var(--text-primary)] text-white"
                  : i < stepIndex
                    ? "bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer"
                    : "bg-gray-100 text-[var(--text-tertiary)]"
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold border border-current">
                {i < stepIndex ? "\u2713" : i + 1}
              </span>
              {STEP_LABELS[s]}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 h-px ${i < stepIndex ? "bg-green-300" : "bg-gray-200"}`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ─── Step 1: Identity ─────────────────────────────────── */}
      {step === "identity" && (
        <div className="space-y-6">
          <div className="bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-6 space-y-4">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">
              Client Identity
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Basic information about this platform instance.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  value={identity.client_name}
                  onChange={(e) =>
                    setIdentity({ ...identity, client_name: e.target.value })
                  }
                  placeholder="Canadian Supply Chain"
                  className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Short Name *
                </label>
                <input
                  type="text"
                  value={identity.client_short_name}
                  onChange={(e) =>
                    setIdentity({
                      ...identity,
                      client_short_name: e.target.value,
                    })
                  }
                  placeholder="CSC"
                  className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Domain
                </label>
                <input
                  type="text"
                  value={identity.client_domain}
                  onChange={(e) =>
                    setIdentity({ ...identity, client_domain: e.target.value })
                  }
                  placeholder="campusstores.ca"
                  className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Support Email *
                </label>
                <input
                  type="email"
                  value={identity.support_email}
                  onChange={(e) =>
                    setIdentity({ ...identity, support_email: e.target.value })
                  }
                  placeholder="support@campusstores.ca"
                  className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Logo URL
                </label>
                <input
                  type="text"
                  value={identity.logo_url}
                  onChange={(e) =>
                    setIdentity({ ...identity, logo_url: e.target.value })
                  }
                  placeholder="https://example.com/logo.png"
                  className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Primary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={identity.primary_color}
                    onChange={(e) =>
                      setIdentity({
                        ...identity,
                        primary_color: e.target.value,
                      })
                    }
                    className="w-10 h-[38px] p-0.5 border border-[var(--border-default)] rounded-[var(--radius-md)] cursor-pointer"
                  />
                  <input
                    type="text"
                    value={identity.primary_color}
                    onChange={(e) =>
                      setIdentity({
                        ...identity,
                        primary_color: e.target.value,
                      })
                    }
                    className="flex-1 px-3 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Step 2: Features ─────────────────────────────────── */}
      {step === "features" && (
        <div className="space-y-6">
          <div className="bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-1">
              Platform Features
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Select which capabilities this instance needs. Core features
              cannot be disabled.
            </p>

            <div className="space-y-3">
              {featureRows.map((f) => (
                <label
                  key={f.key}
                  className={`flex items-start gap-3 p-3 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
                    f.enabled
                      ? "border-blue-200 bg-blue-50/50"
                      : "border-[var(--border-default)] hover:border-[var(--text-tertiary)]"
                  } ${f.alwaysOn ? "opacity-80" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={f.alwaysOn}
                    onChange={(e) => {
                      if (f.alwaysOn) return;
                      setFeatureState((prev) => ({
                        ...prev,
                        [f.key]: e.target.checked,
                      }));
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {f.label}
                      </span>
                      {f.alwaysOn && (
                        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-[var(--text-tertiary)]">
                          Core
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {f.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Step 3: Config ───────────────────────────────────── */}
      {step === "config" && (
        <div className="space-y-6">
          <div className="bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-1">
              Initial Configuration
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Review and adjust the default policy values for your enabled
              features. You can change these at any time after setup.
            </p>

            {enabledCategories.length > 0 ? (
              <>
                {/* Category tabs */}
                <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-[var(--radius-lg)] w-fit flex-wrap">
                  {enabledCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setConfigTab(cat)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors whitespace-nowrap capitalize ${
                        configTab === cat
                          ? "bg-white text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Policy values for selected category */}
                {draftSetId && configTab ? (
                  <PolicyTab
                    values={draftValues.filter(
                      (v) => v.category === configTab
                    )}
                    publishedValues={[]}
                    isEditing={true}
                    draftSetId={draftSetId}
                  />
                ) : (
                  <p className="text-sm text-[var(--text-secondary)] py-8 text-center">
                    {hasPolicySet
                      ? "An active policy set already exists. You can edit it after completing setup."
                      : "Policy draft will be created with sensible defaults. You can adjust values after setup."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--text-secondary)] py-8 text-center">
                No enabled features require policy configuration.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ─── Step 4: Review ───────────────────────────────────── */}
      {step === "review" && (
        <div className="space-y-6">
          <div className="bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">
              Review & Activate
            </h2>

            {/* Identity summary */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                Client Identity
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-[var(--text-tertiary)]">Name: </span>
                  <span className="text-[var(--text-primary)]">
                    {identity.client_name}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)]">Short: </span>
                  <span className="text-[var(--text-primary)]">
                    {identity.client_short_name}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)]">Domain: </span>
                  <span className="text-[var(--text-primary)]">
                    {identity.client_domain || "(not set)"}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)]">Support: </span>
                  <span className="text-[var(--text-primary)]">
                    {identity.support_email}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">
                  Brand:
                </span>
                <div
                  className="w-5 h-5 rounded border border-[var(--border-default)]"
                  style={{ backgroundColor: identity.primary_color }}
                />
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {identity.primary_color}
                </span>
              </div>
            </div>

            {/* Features summary */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                Enabled Features
              </h3>
              <div className="flex flex-wrap gap-2">
                {featureRows
                  .filter((f) => f.enabled)
                  .map((f) => (
                    <span
                      key={f.key}
                      className={`text-xs px-2 py-1 rounded-full ${
                        f.alwaysOn
                          ? "bg-gray-100 text-[var(--text-secondary)]"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {f.label}
                      {f.alwaysOn ? " (core)" : ""}
                    </span>
                  ))}
              </div>
              {featureRows.some((f) => !f.enabled) && (
                <div className="mt-2">
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Disabled:{" "}
                    {featureRows
                      .filter((f) => !f.enabled)
                      .map((f) => f.label)
                      .join(", ")}
                  </span>
                </div>
              )}
            </div>

            {/* Confirmation */}
            <div className="border-t border-[var(--border-default)] pt-4">
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                This will activate the platform with the configuration above.
                {!hasPolicySet &&
                  " An initial policy set will be published with the default values."}
              </p>
              <div className="flex items-center gap-3">
                <label className="text-sm text-[var(--text-primary)] font-medium">
                  Type ACTIVATE to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="ACTIVATE"
                  className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono w-32"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Navigation ───────────────────────────────────────── */}
      <div className="flex items-center justify-between mt-6">
        <div>
          {stepIndex > 0 && (
            <button
              onClick={handleBack}
              disabled={loading}
              className="px-4 py-2 text-sm border border-[var(--border-default)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors disabled:opacity-50"
            >
              Back
            </button>
          )}
        </div>
        <div>
          {step === "review" ? (
            <button
              onClick={handleActivate}
              disabled={loading || confirmText !== "ACTIVATE"}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-[var(--radius-md)] hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
            >
              {loading ? "Activating..." : "Activate Platform"}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={loading}
              className="px-6 py-2 text-sm bg-[var(--text-primary)] text-white rounded-[var(--radius-md)] hover:opacity-90 transition-opacity disabled:opacity-50 font-medium"
            >
              {loading ? "Saving..." : "Continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
