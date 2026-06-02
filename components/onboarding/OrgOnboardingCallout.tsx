"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, completeOnboardingStep } from "@/lib/actions/onboarding";
import type { OrgAdminStepKey } from "@/lib/onboarding/steps";
import ToolkitTourModal from "@/components/onboarding/ToolkitTourModal";

interface OrgOnboardingCalloutProps {
  orgSlug: string;
}

interface StepConfig {
  // Phase: intro — introduce the task
  heading: string;
  body: string;
  ctaLabel: string;
  // The data-onboarding attribute on the target element (on-page steps)
  targetAttr?: string;
  // For navigation steps: route to send the user to when CTA is clicked
  targetPath?: string;
  // Which field save triggers completion — single or array (any match completes)
  // Optional for steps that complete on CTA click (completesOnCta: true)
  completionTrigger?: { table: string; column: string } | { table: string; column: string }[];
  // If true, the step completes immediately when the CTA is clicked (before navigating)
  completesOnCta?: boolean;
  /**
   * guided: true  — full 4-phase flow (scroll → open Toolkit → click Edit → pulse field)
   *                 Used for the very first step before the user knows the Toolkit.
   * guided: false — CTA scrolls to field and closes callout; component listens quietly
   *                 for the save. Used for steps after the toolkit tour.
   */
  guided: boolean;
  // Only used when guided: true
  fieldHeading?: string;
  fieldBody?: string;
  // If set, this field-updated event advances show-field → highlight-edit
  // instead of waiting for the FAB click
  showFieldTrigger?: { table: string; column: string };
  // If true, the step completes when edit mode activates (highlight-edit phase)
  // rather than waiting for a field save in highlight-field
  completesOnEditMode?: boolean;
  // If set, only show this step for org admins whose org matches one of these types.
  orgTypes?: string[];
}

const STEP_CONFIGS: Partial<Record<OrgAdminStepKey, StepConfig>> = {
  public_contact_email: {
    heading: "Set your store's public email",
    body: "This is the address members and partners use to reach you. Use a shared inbox — not a personal address.",
    ctaLabel: "Show me",
    targetAttr: "public_contact_email",
    completionTrigger: { table: "organizations", column: "email" },
    guided: true,
    fieldHeading: "Now open your Toolkit",
    fieldBody: "Tap the + button at the bottom right to open it.",
  },
  contacts_sorted: {
    heading: "Are your people right?",
    body: "Open Edit and click any person to update their info. You'll also see an eye icon — use it to hide anyone who'd rather stay private.",
    ctaLabel: "Take me there",
    targetAttr: "contacts_section",
    completionTrigger: [
      { table: "contacts", column: "name" },
      { table: "contacts", column: "work_email" },
      { table: "contacts", column: "role_title" },
      { table: "contacts", column: "work_phone_number" },
      { table: "contacts", column: "hidden" },
    ],
    guided: false,
  },
  profile_logo: {
    heading: "Add your store's logo",
    body: "Open Edit and click your logo area to upload. Any clean horizontal logo works best.",
    ctaLabel: "Take me there",
    targetAttr: "profile_logo",
    completionTrigger: [
      { table: "organizations", column: "logo_url" },
      { table: "organizations", column: "logo_horizontal_url" },
    ],
    guided: false,
  },
  profile_hero: {
    heading: "Add a hero image",
    body: "Open Edit and click the image strip on the left to upload a campus or store photo.",
    ctaLabel: "Take me there",
    targetAttr: "profile_hero",
    completionTrigger: { table: "organizations", column: "hero_image_url" },
    guided: false,
  },
  network_member_space: {
    heading: "See yourself through a partner's eyes",
    body: "That bar at the bottom of your page? Hit \"View as Partner\" — that's exactly what vendors see when they look you up.",
    ctaLabel: "Take me there",
    targetAttr: "view_as_partner",
    guided: true,
    fieldHeading: "Now let's make it count",
    fieldBody: "You're seeing what partners see. Open the Toolkit and click Edit to control it.",
    showFieldTrigger: { table: "organizations", column: "_partner_view_toggled" },
    completionTrigger: { table: "organizations", column: "_unused" },
    completesOnEditMode: true,
    orgTypes: ["Member"],
  },
  partner_catalogue: {
    heading: "Get your catalogue in front of members",
    body: "Members are looking for you. Upload your catalogue, price lists, and documents so they can find what they need without picking up the phone.",
    ctaLabel: "Take me there",
    targetAttr: "partner_links",
    completionTrigger: { table: "organizations", column: "_partner_link_added" },
    guided: false,
    orgTypes: ["Partner", "Vendor"],
  },
  network_partners: {
    heading: "See what's stocked for you",
    body: "Your member directory comes with a full list of suppliers, vendors, and partners. Explore who's already working with stores like yours.",
    ctaLabel: "Browse partners",
    targetPath: "/partners",
    completesOnCta: true,
    guided: false,
    orgTypes: ["Member"],
  },
  network_members: {
    heading: "Meet your members",
    body: "Here's everyone you serve. Browse the directory to see which stores are active on the platform — they can already find you.",
    ctaLabel: "See the directory",
    targetPath: "/members",
    completesOnCta: true,
    guided: false,
    orgTypes: ["Partner", "Vendor"],
  },
  events_discovery: {
    heading: "Stay in the loop",
    body: "CSC runs conferences, webinars, and regional events throughout the year. See what's coming up and add the ones that matter to your calendar.",
    ctaLabel: "View upcoming events",
    targetPath: "/events",
    completesOnCta: true,
    guided: false,
  },
  benchmarking_survey: {
    heading: "Help shape the industry",
    body: "Our annual benchmarking survey takes about 10 minutes and helps every member understand where they stand. Your data stays anonymous.",
    ctaLabel: "Take the survey",
    targetPath: "/benchmarking/survey",
    completesOnCta: true,
    guided: false,
    orgTypes: ["Member"],
  },
};

type Phase =
  | "intro"       // callout visible, intro text + CTA
  | "show-field"  // field highlighted, callout tells user to open Toolkit
  | "highlight-edit"  // callout hidden, Edit button pulsing in Toolkit
  | "highlight-field" // callout hidden, email field pulsing, waiting for save
  | "done";

export default function OrgOnboardingCallout({ orgSlug }: OrgOnboardingCalloutProps) {
  const { user, organizations, isLoading } = useAuth();
  const [activeStep, setActiveStep] = useState<OrgAdminStepKey | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [showTour, setShowTour] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const fieldHighlightRef = useRef<Element | null>(null);

  const orgMembership = organizations.find(
    (o) => o.role === "org_admin" && o.organization.slug === orgSlug
  );
  const isOwnOrgPage = Boolean(orgMembership);
  const orgType: string = orgMembership?.organization?.type ?? "";

  // Find the first incomplete configured step
  useEffect(() => {
    if (isLoading || !user || !isOwnOrgPage) return;
    let cancelled = false;

    async function findActiveStep() {
      const steps = Object.keys(STEP_CONFIGS) as OrgAdminStepKey[];
      for (const stepKey of steps) {
        const config = STEP_CONFIGS[stepKey];
        // Skip steps that don't apply to this org type
        if (config?.orgTypes && !config.orgTypes.includes(orgType)) continue;
        const result = await getOnboardingStep(stepKey);
        if (cancelled) return;
        if (result.success && (!result.step || !result.step.completed_at)) {
          setActiveStep(stepKey);
          setPhase("intro");
          return;
        }
      }
    }

    void findActiveStep();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user?.id, isOwnOrgPage, orgType, refreshTick]);

  // Phase: show-field → listen for Toolkit FAB click OR showFieldTrigger → highlight-edit
  useEffect(() => {
    if (phase !== "show-field" || !activeStep) return;
    const config = STEP_CONFIGS[activeStep];

    function onFabClick(e: MouseEvent) {
      if ((e.target as HTMLElement).closest("[data-toolkit-fab]")) {
        setPhase("highlight-edit");
      }
    }
    document.addEventListener("click", onFabClick, { capture: true });

    // Some steps advance via a field event rather than FAB click
    function onFieldUpdated(e: Event) {
      if (!config?.showFieldTrigger) return;
      const { table, column } = (e as CustomEvent<{ table: string; column: string }>).detail;
      if (table === config.showFieldTrigger.table && column === config.showFieldTrigger.column) {
        setPhase("highlight-edit");
      }
    }
    window.addEventListener("csc:field-updated", onFieldUpdated);

    return () => {
      document.removeEventListener("click", onFabClick, { capture: true });
      window.removeEventListener("csc:field-updated", onFieldUpdated);
    };
  }, [phase, activeStep]);

  // Phase: highlight-edit → dispatch event to Toolkit, listen for edit mode activation
  useEffect(() => {
    if (phase !== "highlight-edit" || !activeStep) return;
    const config = STEP_CONFIGS[activeStep];

    window.dispatchEvent(new CustomEvent("csc:onboarding:highlight-edit", { detail: { tool: "edit" } }));

    function onEditMode(e: Event) {
      if (!(e as CustomEvent<{ active: boolean }>).detail.active) return;
      if (config?.completesOnEditMode) {
        void markComplete();
      } else {
        setPhase("highlight-field");
      }
    }
    window.addEventListener("csc:edit-mode-changed", onEditMode);
    return () => window.removeEventListener("csc:edit-mode-changed", onEditMode);
  }, [phase, activeStep]);

  // Phase: highlight-field → add pulsing ring to the target element
  useEffect(() => {
    if (phase !== "highlight-field" || !activeStep) return;
    const config = STEP_CONFIGS[activeStep];
    if (!config) return;

    const el = document.querySelector(`[data-onboarding="${config.targetAttr}"]`);
    if (el) {
      el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse");
      fieldHighlightRef.current = el;
    }

    return () => {
      if (fieldHighlightRef.current) {
        fieldHighlightRef.current.classList.remove(
          "ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse"
        );
        fieldHighlightRef.current = null;
      }
    };
  }, [phase, activeStep]);

  // Always listen for field save to complete the step
  const handleFieldUpdated = useCallback(
    (e: Event) => {
      if (!activeStep) return;
      const config = STEP_CONFIGS[activeStep];
      if (!config || !config.completionTrigger) return;
      const { table, column } = (e as CustomEvent<{ table: string; column: string }>).detail;
      const triggers = Array.isArray(config.completionTrigger)
        ? config.completionTrigger
        : [config.completionTrigger];
      if (triggers.some((t) => t.table === table && t.column === column)) {
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
    if (!activeStep) return;
    const completingStep = activeStep;
    // Clean up field highlight
    if (fieldHighlightRef.current) {
      fieldHighlightRef.current.classList.remove(
        "ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse"
      );
      fieldHighlightRef.current = null;
    }
    try {
      await completeOnboardingStep(completingStep);
    } catch { /* non-fatal */ }
    setPhase("done");
    setActiveStep(null);
    // Tour only fires after the first edit — subsequent steps just advance
    if (completingStep === "public_contact_email") {
      setShowTour(true);
    } else {
      setRefreshTick((t) => t + 1);
    }
  }

  async function handleCta() {
    if (!activeStep) return;
    const config = STEP_CONFIGS[activeStep];
    if (!config) return;

    // Navigation step: complete immediately then send the user to another page
    if (config.completesOnCta && config.targetPath) {
      await markComplete();
      window.location.assign(config.targetPath);
      return;
    }

    const el = document.querySelector(`[data-onboarding="${config.targetAttr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (config.guided) {
        // Guided: brief flash only — the highlight-field phase takes over
        el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded");
        setTimeout(() => el.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded"), 2500);
      } else {
        // Non-guided: persistent pulse so they know exactly what to look at
        el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse");
        fieldHighlightRef.current = el;
      }
    }

    if (config.guided) {
      setPhase("show-field");
    } else {
      setPhase("done");
    }
  }

  // Only render the bubble during intro and show-field phases
  const bubbleVisible = phase === "intro" || phase === "show-field";
  if (showTour) {
    return <ToolkitTourModal onDone={() => setShowTour(false)} />;
  }

  if (!activeStep || phase === "done" || !bubbleVisible) return null;

  const config = STEP_CONFIGS[activeStep];
  if (!config) return null;

  const heading = phase === "intro" ? config.heading : (config.fieldHeading ?? config.heading);
  const body    = phase === "intro" ? config.body   : (config.fieldBody   ?? config.body);

  return (
    <div
      className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="complementary"
      aria-label="Onboarding guidance"
    >
      <div className="relative bg-[#1A1A1A] text-white rounded-xl shadow-xl px-4 py-3 max-w-[260px]">

        <button
          onClick={() => setPhase("done")}
          className="absolute top-2 right-2 text-white/40 hover:text-white/80 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <p className="text-[10px] font-semibold text-[#EE2A2E] uppercase tracking-widest mb-1">
          Getting started
        </p>
        <p className="text-sm font-semibold leading-snug pr-5 mb-1">{heading}</p>
        <p className="text-xs text-white/70 leading-snug mb-3">{body}</p>

        {phase === "intro" && (
          <button
            onClick={handleCta}
            className="w-full py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {config.ctaLabel}
          </button>
        )}

        {/* Arrow toward Toolkit FAB — only shown when directing user there */}
        {phase === "show-field" && (
          <div className="absolute -bottom-2 right-6 w-4 h-2 overflow-hidden">
            <div className="w-3 h-3 bg-[#1A1A1A] rotate-45 translate-y-[-50%] ml-0.5" />
          </div>
        )}
      </div>
    </div>
  );
}
