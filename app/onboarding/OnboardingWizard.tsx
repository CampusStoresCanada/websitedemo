"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveOnboardingStep, completeOnboarding } from "@/lib/actions/applications";
import { PROVINCES } from "@/lib/constants/provinces";
import { PRODUCT_CATEGORIES } from "@/lib/types/procurement";
import {
  PARTNER_PRIMARY_CATEGORIES,
  PARTNER_SECONDARY_CATEGORIES,
  SECONDARY_TO_PRIMARY,
  type PartnerSecondaryCategory,
} from "@/lib/constants/partner-categories";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  org: Record<string, unknown>;
  orgType: "Member" | "Vendor Partner";
  initialStep: number;
}

// Members: steps 1-4 + completion. Partners: steps 1-3, 5 + completion.
function getSteps(orgType: "Member" | "Vendor Partner") {
  const base = [
    { num: 1, label: "Public Profile" },
    { num: 2, label: "Private Profile" },
    { num: 3, label: "Admin Account" },
  ];
  if (orgType === "Member") {
    base.push({ num: 4, label: "Purchasing Profile" });
  } else {
    base.push({ num: 5, label: "Sales Profile" });
  }
  base.push({ num: 6, label: "Complete" });
  return base;
}

// ─────────────────────────────────────────────────────────────────
// Main Wizard
// ─────────────────────────────────────────────────────────────────

export function OnboardingWizard({
  org,
  orgType,
  initialStep,
}: OnboardingWizardProps) {
  const router = useRouter();
  const steps = getSteps(orgType);

  // Current step index (0-based into the steps array)
  const startIdx = Math.max(
    0,
    steps.findIndex((s) => s.num > initialStep)
  );
  const [stepIdx, setStepIdx] = useState(startIdx === -1 ? 0 : startIdx);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStep = steps[stepIdx];
  const orgId = org.id as string;

  // Save step data and advance
  async function handleSaveAndNext(data: Record<string, unknown>) {
    setError(null);
    setIsLoading(true);

    const result = await saveOnboardingStep(orgId, currentStep.num, data);

    setIsLoading(false);

    if (!result.success) {
      setError(result.error || "Failed to save. Please try again.");
      return;
    }

    // Advance to next step
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
    }
  }

  async function handleComplete() {
    setError(null);
    setIsLoading(true);

    const result = await completeOnboarding(orgId);

    setIsLoading(false);

    if (!result.success) {
      setError(result.error || "Failed to complete onboarding.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  function goBack() {
    if (stepIdx > 0) {
      setStepIdx(stepIdx - 1);
      setError(null);
    }
  }

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 mb-8">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                i === stepIdx
                  ? "bg-[#EE2A2E] text-white"
                  : i < stepIdx
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < stepIdx ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m4.5 12.75 6 6 9-13.5"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-6 h-0.5 ${
                  i < stepIdx ? "bg-green-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step label */}
      <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">
        {currentStep.label}
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Step {stepIdx + 1} of {steps.length}
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        {currentStep.num === 1 && (
          <Step1PublicProfile
            org={org}
            isLoading={isLoading}
            onSave={handleSaveAndNext}
          />
        )}
        {currentStep.num === 2 && (
          <Step2PrivateProfile
            org={org}
            isLoading={isLoading}
            onSave={handleSaveAndNext}
            onBack={goBack}
          />
        )}
        {currentStep.num === 3 && (
          <Step3AdminAccount
            org={org}
            isLoading={isLoading}
            onSave={handleSaveAndNext}
            onBack={goBack}
          />
        )}
        {currentStep.num === 4 && (
          <Step4PurchasingProfile
            org={org}
            isLoading={isLoading}
            onSave={handleSaveAndNext}
            onBack={goBack}
          />
        )}
        {currentStep.num === 5 && (
          <Step5SalesProfile
            org={org}
            isLoading={isLoading}
            onSave={handleSaveAndNext}
            onBack={goBack}
          />
        )}
        {currentStep.num === 6 && (
          <StepCompletion
            org={org}
            orgType={orgType}
            isLoading={isLoading}
            onComplete={handleComplete}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared form style constants
// ─────────────────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors";
const selectClass = `${inputClass} bg-white`;
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

// ─────────────────────────────────────────────────────────────────
// Step 1: Public Profile
// ─────────────────────────────────────────────────────────────────

function Step1PublicProfile({
  org,
  isLoading,
  onSave,
}: {
  org: Record<string, unknown>;
  isLoading: boolean;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [description, setDescription] = useState(
    (org.company_description as string) || ""
  );
  const [streetAddress, setStreetAddress] = useState(
    (org.street_address as string) || ""
  );
  const [city, setCity] = useState((org.city as string) || "");
  const [province, setProvince] = useState((org.province as string) || "");
  const [postalCode, setPostalCode] = useState(
    (org.postal_code as string) || ""
  );
  const [email, setEmail] = useState((org.email as string) || "");
  const [phone, setPhone] = useState((org.phone as string) || "");
  const [website, setWebsite] = useState((org.website as string) || "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      company_description: description.trim(),
      street_address: streetAddress.trim(),
      city: city.trim(),
      province,
      postal_code: postalCode.trim().toUpperCase(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500 mb-2">
        This information will be visible in the CSC directory.
      </p>

      <div>
        <label htmlFor="ob-desc" className={labelClass}>
          Organization description
        </label>
        <textarea
          id="ob-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-none`}
          placeholder="Brief description for the public directory…"
        />
      </div>

      <div>
        <label htmlFor="ob-street" className={labelClass}>
          Street address
        </label>
        <input
          id="ob-street"
          type="text"
          value={streetAddress}
          onChange={(e) => setStreetAddress(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="ob-city" className={labelClass}>City</label>
          <input
            id="ob-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ob-prov" className={labelClass}>Province</label>
          <select
            id="ob-prov"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className={selectClass}
          >
            <option value="">Select…</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ob-postal" className={labelClass}>Postal code</label>
          <input
            id="ob-postal"
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ob-email" className={labelClass}>Public email</label>
          <input
            id="ob-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ob-phone" className={labelClass}>Phone</label>
          <input
            id="ob-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="ob-web" className={labelClass}>Website</label>
        <input
          id="ob-web"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step 2: Private Profile
// ─────────────────────────────────────────────────────────────────

function Step2PrivateProfile({
  org,
  isLoading,
  onSave,
  onBack,
}: {
  org: Record<string, unknown>;
  isLoading: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onBack: () => void;
}) {
  const meta = (org.metadata as Record<string, unknown>) || {};
  const [billingAddress, setBillingAddress] = useState(
    (meta.billing_address as string) || ""
  );
  const [internalNotes, setInternalNotes] = useState(
    (meta.internal_notes as string) || ""
  );
  const [fiscalYearStart, setFiscalYearStart] = useState(
    (meta.fiscal_year_start as string) || ""
  );

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      billing_address: billingAddress.trim(),
      internal_notes: internalNotes.trim(),
      fiscal_year_start: fiscalYearStart,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500 mb-2">
        This information is internal and will not be shown publicly.
      </p>

      <div>
        <label htmlFor="ob-billing" className={labelClass}>
          Billing address <span className="text-xs text-gray-400 font-normal">(if different from public)</span>
        </label>
        <textarea
          id="ob-billing"
          rows={2}
          value={billingAddress}
          onChange={(e) => setBillingAddress(e.target.value)}
          className={`${inputClass} resize-none`}
          placeholder="Full billing address…"
        />
      </div>

      <div>
        <label htmlFor="ob-notes" className={labelClass}>
          Internal notes
        </label>
        <textarea
          id="ob-notes"
          rows={2}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          className={`${inputClass} resize-none`}
          placeholder="Any notes for CSC staff…"
        />
      </div>

      <div>
        <label htmlFor="ob-fiscal" className={labelClass}>
          Fiscal year start month
        </label>
        <select
          id="ob-fiscal"
          value={fiscalYearStart}
          onChange={(e) => setFiscalYearStart(e.target.value)}
          className={selectClass}
        >
          <option value="">Select month…</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step 3: Admin Account Setup
// ─────────────────────────────────────────────────────────────────

function Step3AdminAccount({
  org,
  isLoading,
  onSave,
  onBack,
}: {
  org: Record<string, unknown>;
  isLoading: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onBack: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreedToTerms) return;
    onSave({
      display_name: displayName.trim() || undefined,
      agreed_to_terms: true,
      agreed_at: new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500 mb-2">
        Confirm your admin account details for <strong>{org.name as string}</strong>.
      </p>

      <div>
        <label htmlFor="ob-name" className={labelClass}>
          Your full name
        </label>
        <input
          id="ob-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
          placeholder="Jane Smith"
        />
      </div>

      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
          />
          <span className="text-sm text-gray-700">
            I agree to the Campus Stores Canada{" "}
            <a href="/terms" className="text-[#EE2A2E] hover:text-[#D92327] font-medium" target="_blank">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="text-[#EE2A2E] hover:text-[#D92327] font-medium" target="_blank">
              Privacy Policy
            </a>
            .
          </span>
        </label>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={isLoading || !agreedToTerms}
          className="flex-1 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step 4: Purchasing Profile (Members only)
// ─────────────────────────────────────────────────────────────────

function Step4PurchasingProfile({
  org,
  isLoading,
  onSave,
  onBack,
}: {
  org: Record<string, unknown>;
  isLoading: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onBack: () => void;
}) {
  const existing = (org.procurement_info as Record<string, unknown>) || {};
  const [categories, setCategories] = useState<string[]>(
    (existing.product_categories as string[]) || []
  );
  const [buyLocal, setBuyLocal] = useState(
    ((existing.requirements as Record<string, unknown>)?.buy_local as boolean) || false
  );
  const [indigenousOwned, setIndigenousOwned] = useState(
    ((existing.requirements as Record<string, unknown>)?.indigenous_owned as boolean) || false
  );
  const [sustainability, setSustainability] = useState(
    ((existing.requirements as Record<string, unknown>)?.sustainability_certs as string[])?.join(", ") || ""
  );
  const [fiscalYearStart, setFiscalYearStart] = useState(
    ((existing.buying_cycle as Record<string, unknown>)?.fiscal_year_start as string) || ""
  );
  const [rfpWindow, setRfpWindow] = useState(
    ((existing.buying_cycle as Record<string, unknown>)?.rfp_window as string) || ""
  );
  const [keyDates, setKeyDates] = useState(
    ((existing.buying_cycle as Record<string, unknown>)?.key_dates as string) || ""
  );

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      product_categories: categories,
      requirements: {
        buy_local: buyLocal,
        indigenous_owned: indigenousOwned,
        sustainability_certs: sustainability
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      buying_cycle: {
        fiscal_year_start: fiscalYearStart,
        rfp_window: rfpWindow.trim(),
        key_dates: keyDates.trim(),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500 mb-2">
        Help vendors understand your purchasing needs.
      </p>

      <div>
        <p className={labelClass}>Product categories of interest</p>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {PRODUCT_CATEGORIES.map((cat) => (
            <label
              key={cat}
              className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                categories.includes(cat)
                  ? "border-[#EE2A2E] bg-red-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={categories.includes(cat)}
                onChange={() => toggleCategory(cat)}
                className="sr-only"
              />
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  categories.includes(cat)
                    ? "bg-[#EE2A2E] border-[#EE2A2E]"
                    : "border-gray-300"
                }`}
              >
                {categories.includes(cat) && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={3}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                )}
              </div>
              <span className="text-xs">{cat}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <p className={labelClass}>Procurement requirements</p>
        <div className="space-y-2 mt-1">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={buyLocal}
              onChange={(e) => setBuyLocal(e.target.checked)}
              className="rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
            />
            Buy-local policies apply
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={indigenousOwned}
              onChange={(e) => setIndigenousOwned(e.target.checked)}
              className="rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
            />
            Indigenous-owned vendor preferences
          </label>
        </div>
      </div>

      <div>
        <label htmlFor="ob-sustain" className={labelClass}>
          Sustainability certifications <span className="text-xs text-gray-400 font-normal">(comma-separated)</span>
        </label>
        <input
          id="ob-sustain"
          type="text"
          value={sustainability}
          onChange={(e) => setSustainability(e.target.value)}
          className={inputClass}
          placeholder="Fair Trade, B Corp, FSC…"
        />
      </div>

      <div className="border-t border-gray-200 pt-4">
        <p className={labelClass}>Buying cycle</p>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <label htmlFor="ob-fiscal-buy" className="block text-xs text-gray-500 mb-1">
              Fiscal year start
            </label>
            <input
              id="ob-fiscal-buy"
              type="text"
              value={fiscalYearStart}
              onChange={(e) => setFiscalYearStart(e.target.value)}
              className={inputClass}
              placeholder="April"
            />
          </div>
          <div>
            <label htmlFor="ob-rfp" className="block text-xs text-gray-500 mb-1">
              RFP window
            </label>
            <input
              id="ob-rfp"
              type="text"
              value={rfpWindow}
              onChange={(e) => setRfpWindow(e.target.value)}
              className={inputClass}
              placeholder="January - March"
            />
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="ob-keydates" className="block text-xs text-gray-500 mb-1">
            Key dates for vendors
          </label>
          <input
            id="ob-keydates"
            type="text"
            value={keyDates}
            onChange={(e) => setKeyDates(e.target.value)}
            className={inputClass}
            placeholder="Textbook adoption deadline: June 15"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step 5: Sales Profile (Partners only)
// ─────────────────────────────────────────────────────────────────

function Step5SalesProfile({
  org,
  isLoading,
  onSave,
  onBack,
}: {
  org: Record<string, unknown>;
  isLoading: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onBack: () => void;
}) {
  const meta = (org.metadata as Record<string, unknown>) || {};
  const [primaryCategory, setPrimaryCategory] = useState(
    (org.primary_category as string) || ""
  );
  const [secondaryCategories, setSecondaryCategories] = useState<string[]>(
    (meta.secondary_categories as string[]) || []
  );
  const [certifications, setCertifications] = useState<string[]>(
    (meta.certifications as string[]) || []
  );
  const [description, setDescription] = useState(
    (org.company_description as string) || ""
  );
  const [leadTimes, setLeadTimes] = useState(
    (meta.lead_times as string) || ""
  );
  const [moq, setMoq] = useState((meta.moq as string) || "");

  const CERT_OPTIONS = [
    "Sustainability Certified",
    "Indigenous-Owned",
    "Woman-Owned",
    "Product of Canada",
    "B Corp",
  ];

  const filteredSecondary = primaryCategory
    ? PARTNER_SECONDARY_CATEGORIES.filter(
        (sc) => SECONDARY_TO_PRIMARY[sc] === primaryCategory
      )
    : [];

  function toggleSecondary(cat: string) {
    setSecondaryCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function toggleCert(cert: string) {
    setCertifications((prev) =>
      prev.includes(cert) ? prev.filter((c) => c !== cert) : [...prev, cert]
    );
  }

  function handlePrimaryChange(value: string) {
    setPrimaryCategory(value);
    setSecondaryCategories((prev) =>
      prev.filter(
        (sc) =>
          SECONDARY_TO_PRIMARY[sc as PartnerSecondaryCategory] === value
      )
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      primary_category: primaryCategory,
      secondary_categories: secondaryCategories,
      certifications,
      company_description: description.trim(),
      lead_times: leadTimes.trim(),
      moq: moq.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500 mb-2">
        Help campus stores understand your products and services.
      </p>

      <div>
        <label htmlFor="ob-primary-cat" className={labelClass}>
          Primary category
        </label>
        <select
          id="ob-primary-cat"
          value={primaryCategory}
          onChange={(e) => handlePrimaryChange(e.target.value)}
          className={selectClass}
        >
          <option value="">Select category…</option>
          {PARTNER_PRIMARY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {filteredSecondary.length > 0 && (
        <div>
          <p className={labelClass}>Secondary categories</p>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {filteredSecondary.map((cat) => (
              <label
                key={cat}
                className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                  secondaryCategories.includes(cat)
                    ? "border-[#EE2A2E] bg-red-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={secondaryCategories.includes(cat)}
                  onChange={() => toggleSecondary(cat)}
                  className="sr-only"
                />
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    secondaryCategories.includes(cat)
                      ? "bg-[#EE2A2E] border-[#EE2A2E]"
                      : "border-gray-300"
                  }`}
                >
                  {secondaryCategories.includes(cat) && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <span className="text-xs">{cat}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-gray-200 pt-4">
        <p className={labelClass}>Certifications</p>
        <div className="flex flex-wrap gap-2 mt-1">
          {CERT_OPTIONS.map((cert) => (
            <button
              key={cert}
              type="button"
              onClick={() => toggleCert(cert)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                certifications.includes(cert)
                  ? "bg-[#EE2A2E] text-white border-[#EE2A2E]"
                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
              }`}
            >
              {cert}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="ob-partner-desc" className={labelClass}>
          Company description <span className="text-xs text-gray-400 font-normal">(for partner directory)</span>
        </label>
        <textarea
          id="ob-partner-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-none`}
          placeholder="Describe your company, products, and services…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ob-lead" className={labelClass}>General lead times</label>
          <input
            id="ob-lead"
            type="text"
            value={leadTimes}
            onChange={(e) => setLeadTimes(e.target.value)}
            className={inputClass}
            placeholder="2-4 weeks"
          />
        </div>
        <div>
          <label htmlFor="ob-moq" className={labelClass}>MOQ / sales policies</label>
          <input
            id="ob-moq"
            type="text"
            value={moq}
            onChange={(e) => setMoq(e.target.value)}
            className={inputClass}
            placeholder="No minimum"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step 6: Completion
// ─────────────────────────────────────────────────────────────────

function StepCompletion({
  org,
  orgType,
  isLoading,
  onComplete,
  onBack,
}: {
  org: Record<string, unknown>;
  orgType: "Member" | "Vendor Partner";
  isLoading: boolean;
  onComplete: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 mx-auto rounded-full bg-green-50 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900">
          You&apos;re all set!
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          <strong>{org.name as string}</strong> is ready to go as a{" "}
          {orgType === "Member" ? "CSC member" : "CSC vendor partner"}.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 text-left">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Summary
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Organization</dt>
            <dd className="font-medium text-gray-900">{org.name as string}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Type</dt>
            <dd className="font-medium text-gray-900">{orgType}</dd>
          </div>
          {org.city ? (
            <div className="flex justify-between">
              <dt className="text-gray-500">Location</dt>
              <dd className="font-medium text-gray-900">
                {String(org.city)}
                {org.province ? `, ${String(org.province)}` : ""}
              </dd>
            </div>
          ) : null}
          {org.website ? (
            <div className="flex justify-between">
              <dt className="text-gray-500">Website</dt>
              <dd className="font-medium text-gray-900 truncate max-w-[200px]">
                {String(org.website)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onComplete}
          disabled={isLoading}
          className="flex-1 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? "Completing…" : "Complete Onboarding"}
        </button>
      </div>
    </div>
  );
}
