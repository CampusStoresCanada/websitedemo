"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, completeOnboardingStep } from "@/lib/actions/onboarding";
import type { OrgAdminStepKey } from "@/lib/onboarding/steps";

interface OrgOnboardingCalloutProps {
  /** The slug of the org page currently being viewed */
  orgSlug: string;
}

interface StepConfig {
  heading: string;
  body: string;
  /** data-onboarding attribute value on the target element, used to scroll to it */
  targetAttr: string;
  /** Which table + column save triggers completion */
  completionTrigger: { table: string; column: string } | null;
  /** CTA label — clicking scrolls to the target field */
  ctaLabel: string;
}

const STEP_CONFIGS: Partial<Record<OrgAdminStepKey, StepConfig>> = {
  public_contact_email: {
    heading: "Set your store's public email",
    body: "This is the address members and partners use to reach you. Use a shared inbox — not a personal address.",
    targetAttr: "public_contact_email",
    completionTrigger: { table: "organizations", column: "email" },
    ctaLabel: "Go to field",
  },
  // Future steps added here as each is built out
};

export default function OrgOnboardingCallout({ orgSlug }: OrgOnboardingCalloutProps) {
  const { user, organizations, isLoading } = useAuth();
  const [activeStep, setActiveStep] = useState<OrgAdminStepKey | null>(null);
  const [visible, setVisible] = useState(false);
  const [completing, setCompleting] = useState(false);

  const isOwnOrgPage = organizations.some(
    (o) => o.role === "org_admin" && o.organization.slug === orgSlug
  );

  // Find the first step that has a config and is not yet complete
  useEffect(() => {
    if (isLoading || !user || !isOwnOrgPage) return;

    let cancelled = false;

    async function findActiveStep() {
      const steps = Object.keys(STEP_CONFIGS) as OrgAdminStepKey[];
      for (const stepKey of steps) {
        const result = await getOnboardingStep(stepKey);
        if (cancelled) return;
        if (result.success && (!result.step || !result.step.completed_at)) {
          setActiveStep(stepKey);
          // Small delay so the page has settled
          setTimeout(() => setVisible(true), 800);
          return;
        }
      }
      // All configured steps done — nothing to show
    }

    void findActiveStep();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user?.id, isOwnOrgPage]);

  // Listen for field saves from the Toolkit
  const handleFieldUpdated = useCallback(
    (e: Event) => {
      if (!activeStep) return;
      const config = STEP_CONFIGS[activeStep];
      if (!config?.completionTrigger) return;

      const { table, column } = (e as CustomEvent<{ table: string; column: string }>).detail;
      if (table === config.completionTrigger.table && column === config.completionTrigger.column) {
        void markComplete();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStep]
  );

  useEffect(() => {
    window.addEventListener("csc:field-updated", handleFieldUpdated);
    return () => window.removeEventListener("csc:field-updated", handleFieldUpdated);
  }, [handleFieldUpdated]);

  async function markComplete() {
    if (!activeStep || completing) return;
    setCompleting(true);
    try {
      await completeOnboardingStep(activeStep);
    } catch {
      // Non-fatal
    }
    setVisible(false);
    setActiveStep(null);
    setCompleting(false);
  }

  function dismiss() {
    setVisible(false);
  }

  function scrollToField() {
    if (!activeStep) return;
    const config = STEP_CONFIGS[activeStep];
    if (!config) return;
    const el = document.querySelector(`[data-onboarding="${config.targetAttr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief highlight pulse
      el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "rounded");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "rounded"), 2000);
    }
  }

  if (!visible || !activeStep) return null;

  const config = STEP_CONFIGS[activeStep];
  if (!config) return null;

  return (
    <div
      className="fixed bottom-24 right-20 z-40 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="complementary"
      aria-label="Onboarding guidance"
    >
      <div className="relative bg-[#1A1A1A] text-white rounded-xl shadow-xl px-4 py-3 max-w-[260px]">

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="absolute top-2 right-2 text-white/40 hover:text-white/80 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Step label */}
        <p className="text-[10px] font-semibold text-[#EE2A2E] uppercase tracking-widest mb-1">
          Getting started
        </p>

        <p className="text-sm font-semibold leading-snug pr-5 mb-1">
          {config.heading}
        </p>
        <p className="text-xs text-white/70 leading-snug mb-3">
          {config.body}
        </p>

        <button
          onClick={scrollToField}
          className="w-full py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {config.ctaLabel}
        </button>

        {/* Arrow pointing down toward the Toolkit FAB */}
        <div className="absolute -bottom-2 right-6 w-4 h-2 overflow-hidden">
          <div className="w-3 h-3 bg-[#1A1A1A] rotate-45 translate-y-[-50%] ml-0.5" />
        </div>
      </div>
    </div>
  );
}
