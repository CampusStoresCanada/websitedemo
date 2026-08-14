"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, completeOnboardingStep } from "@/lib/actions/onboarding";
import type { Persona } from "@/lib/onboarding/steps";
import { STEPS_BY_PERSONA } from "@/lib/onboarding/steps";
import { personaForMembership } from "@/lib/onboarding/persona";
import type { MembershipProgramDef } from "@/lib/policy/types";
import ToolkitTourModal from "@/components/onboarding/ToolkitTourModal";

interface OrgOnboardingCalloutProps {
  orgSlug: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step config type — same phase machine as before
// ─────────────────────────────────────────────────────────────────────────────

interface StepConfig {
  heading: string;
  body: string;
  ctaLabel: string;
  targetAttr?: string;
  targetPath?: string;
  completionTrigger?: { table: string; column: string } | { table: string; column: string }[];
  completesOnCta?: boolean;
  guided: boolean;
  fieldHeading?: string;
  fieldBody?: string;
  showFieldTrigger?: { table: string; column: string };
  completesOnEditMode?: boolean;
  /** In show-field phase, pulse the Toolkit FAB button to draw attention */
  highlightFabInShowField?: boolean;
  /** Complete the step when the user taps the Toolkit FAB (instead of transitioning to highlight-edit) */
  completesOnFabClick?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-persona step configs
// The order keys appear in each map determines which step surfaces next.
// Steps without a config are silently skipped (they may complete via other means).
// ─────────────────────────────────────────────────────────────────────────────

const CONFIGS: Record<Persona, Partial<Record<string, StepConfig>>> = {

  // ── Org Admin: Member store ────────────────────────────────────────────────
  org_admin_member: {
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
    profile_logo: {
      heading: "Add your store's logo",
      body: "Open Edit and click your logo area to upload. A clean horizontal logo works best.",
      ctaLabel: "Take me there",
      targetAttr: "profile_logo",
      completionTrigger: [
        { table: "organizations", column: "logo_url" },
        { table: "organizations", column: "logo_horizontal_url" },
      ],
      guided: false,
    },
    profile_hero: {
      heading: "Add your hero strip image",
      body: "Open Edit and click the coloured strip on the left to upload a campus or store photo.",
      ctaLabel: "Take me there",
      targetAttr: "profile_hero",
      completionTrigger: { table: "organizations", column: "hero_image_url" },
      guided: false,
    },
    contacts_sorted: {
      heading: "Are your people right?",
      body: "Let's make sure the right staff are listed — and that their info is current.",
      ctaLabel: "Show me",
      targetAttr: "contacts_section",
      completionTrigger: [
        { table: "contacts", column: "name" },
        { table: "contacts", column: "work_email" },
        { table: "contacts", column: "role_title" },
        { table: "contacts", column: "work_phone_number" },
        { table: "contacts", column: "hidden" },
      ],
      guided: true,
      fieldHeading: "Now open your Toolkit",
      fieldBody: "Tap the + button at the bottom right, then click Edit. Then click any person to update their info.",
    },
    visibility_intro: {
      heading: "You decide who's visible",
      body: "Anyone on your staff list can be hidden from the community — without being removed. Let's try it.",
      ctaLabel: "Show me",
      targetAttr: "contacts_section",
      completionTrigger: { table: "contacts", column: "hidden" },
      guided: true,
      fieldHeading: "Open your Toolkit and click Edit",
      fieldBody: "Then click any person — you'll see an eye icon next to their name. That's their visibility toggle.",
    },
    network_partners: {
      heading: "See what's stocked for you",
      body: "Browse the partner directory to find suppliers relevant to your store's categories.",
      ctaLabel: "Browse partners",
      targetPath: "/partners",
      completesOnCta: true,
      guided: false,
    },
    network_members: {
      heading: "You're not alone out there",
      body: "See how other campus stores show up — and find peers who might share your challenges.",
      ctaLabel: "See the directory",
      targetPath: "/members",
      completesOnCta: false, // completion happens on the /members page via DirectoryOnboardingCallout
      guided: false,
    },
    events_discovery: {
      heading: "Stay in the loop",
      body: "CSC runs conferences, webinars, and regional events throughout the year. See what's coming up.",
      ctaLabel: "View upcoming events",
      targetPath: "/events",
      completesOnCta: true,
      guided: false,
    },
    benchmarking_survey: {
      heading: "Help shape the industry",
      body: "The annual benchmarking survey takes about 10 minutes. Your data stays anonymous and helps every member understand where they stand.",
      ctaLabel: "Take the survey",
      targetPath: "/benchmarking/survey",
      completesOnCta: true,
      guided: false,
    },
    procurement: {
      heading: "Set up your store's procurement",
      body: "Scroll down to your Procurement section and set which categories you carry — then assign buyers to each one. Each buyer can also manage their own assignments from their My Account.",
      ctaLabel: "Show me",
      targetAttr: "procurement_section",
      completionTrigger: { table: "organizations", column: "procurement_info" },
      guided: false,
    },
    opening_rfp: {
      heading: "Ready to run an RFP?",
      body: "Use the Export tool in the Toolkit to post an RFP and notify the right vendors automatically.",
      ctaLabel: "See my RFPs",
      targetAttr: "rfps_section",
      completesOnCta: true,
      guided: false,
    },
  },

  // ── Org Admin: Vendor Partner ──────────────────────────────────────────────
  org_admin_partner: {
    public_contact_email: {
      heading: "Set your company's public email",
      body: "This is how member stores reach out. Use a shared inbox so nothing falls through the cracks.",
      ctaLabel: "Show me",
      targetAttr: "public_contact_email",
      completionTrigger: { table: "organizations", column: "email" },
      guided: true,
      fieldHeading: "Now open your Toolkit",
      fieldBody: "Tap the + button at the bottom right to open it.",
    },
    profile_logo: {
      heading: "Add your company logo",
      body: "Open Edit and click your logo area to upload. A clean horizontal logo works best.",
      ctaLabel: "Take me there",
      targetAttr: "profile_logo",
      completionTrigger: [
        { table: "organizations", column: "logo_url" },
        { table: "organizations", column: "logo_horizontal_url" },
      ],
      guided: false,
    },
    profile_links_docs: {
      heading: "Get your catalogue in front of members",
      body: "Members are looking for you. Upload your catalogue, price lists, and documents so they can find what they need.",
      ctaLabel: "Take me there",
      targetAttr: "partner_links",
      completionTrigger: { table: "organizations", column: "_partner_link_added" },
      guided: false,
    },
    profile_categories: {
      heading: "Tell members what you sell",
      body: "Open Edit and set your categories. Members filter by these when they're looking for suppliers — be specific.",
      ctaLabel: "Take me there",
      targetAttr: "profile_categories",
      completionTrigger: { table: "organizations", column: "primary_category" },
      guided: false,
    },
    contacts_sorted: {
      heading: "Who's on your team?",
      body: "Members want to know who to call at your company. Let's make sure the right people are listed with accurate info.",
      ctaLabel: "Show me",
      targetAttr: "contacts_section",
      completionTrigger: [
        { table: "contacts", column: "name" },
        { table: "contacts", column: "work_email" },
        { table: "contacts", column: "role_title" },
      ],
      guided: true,
      fieldHeading: "Now open your Toolkit",
      fieldBody: "Tap the + button at the bottom right, click Edit, then click any person to update their info.",
    },
    visibility_intro: {
      heading: "You decide who's visible",
      body: "Any contact can be hidden from the community without being removed. Useful for internal staff.",
      ctaLabel: "Show me",
      targetAttr: "contacts_section",
      completionTrigger: { table: "contacts", column: "hidden" },
      guided: true,
      fieldHeading: "Open your Toolkit and click Edit",
      fieldBody: "Then click any person — the eye icon toggles their visibility. Try it on someone.",
    },
    network_members: {
      heading: "Meet your market",
      body: "Here's every active campus store on the platform. These are the people who buy what you sell.",
      ctaLabel: "See the directory",
      targetPath: "/members",
      completesOnCta: true,
      guided: false,
    },
    network_partners: {
      heading: "See who else is here",
      body: "Browse the full partner directory — useful context for understanding the competitive landscape.",
      ctaLabel: "Browse partners",
      targetPath: "/partners",
      completesOnCta: true,
      guided: false,
    },
    events_discovery: {
      heading: "Stay in the loop",
      body: "CSC runs conferences, webinars, and regional events. The right event is where you meet the right buyer.",
      ctaLabel: "View upcoming events",
      targetPath: "/events",
      completesOnCta: true,
      guided: false,
    },
  },

  // ── Member: campus store employee ─────────────────────────────────────────
  member_member: {
    view_org_page: {
      heading: "This website works a little differently",
      body: "Everything you need is in the Toolkit — that + button at the bottom right. It follows you everywhere on the network.",
      ctaLabel: "Show me",
      guided: true,
      fieldHeading: "There it is",
      fieldBody: "Tap the + button to open your Toolkit and see what it can do.",
      highlightFabInShowField: true,
      completesOnFabClick: true,
    },
    visibility_intro: {
      heading: "You control your own visibility",
      body: "Head to My Account to manage how you appear on the network — including your visibility in the directory and your procurement categories.",
      ctaLabel: "Go to My Account",
      targetPath: "/me",
      completesOnCta: true,
      guided: false,
    },
    procurement: {
      heading: "Tell vendors what you buy",
      body: "In My Account, open Edit my info and set the categories you personally buy for. Vendors use this to find the right contact at your store.",
      ctaLabel: "Go to My Account",
      targetPath: "/me",
      completesOnCta: true,
      guided: false,
    },
    network_partners: {
      heading: "Your personalized supplier list",
      body: "Based on what your store buys, we've matched the most relevant partners for you. Take a look.",
      ctaLabel: "See My Suppliers",
      targetPath: "/partners",
      completesOnCta: true,
      guided: false,
    },
    network_members: {
      heading: "Meet your peers",
      body: "Campus stores across Canada are on the network. Find colleagues at similar institutions.",
      ctaLabel: "Browse members",
      targetPath: "/members",
      completesOnCta: true,
      guided: false,
    },
    events_discovery: {
      heading: "Stay in the loop",
      body: "CSC runs conferences, webinars, and regional events. See what's relevant to you.",
      ctaLabel: "View upcoming events",
      targetPath: "/events",
      completesOnCta: true,
      guided: false,
    },
    my_suppliers: {
      heading: "Your supplier list is ready",
      body: "Scroll down to see the vendors matched to your buying categories.",
      ctaLabel: "See my suppliers",
      targetPath: "#my-suppliers",
      completesOnCta: true,
      guided: false,
    },
  },

  // ── Member: vendor partner employee ───────────────────────────────────────
  member_partner: {
    view_org_page: {
      heading: "This is your company on the network",
      body: "This is what campus stores see when they look you up. The + button at the bottom right gives you tools to interact with any page across the whole network.",
      ctaLabel: "Got it",
      guided: false,
      completesOnCta: true,
    },
    visibility_intro: {
      heading: "You control your own visibility",
      body: "Head to My Account to manage how you appear when member stores search for contacts at your company.",
      ctaLabel: "Go to My Account",
      targetPath: "/me",
      completesOnCta: true,
      guided: false,
    },
    network_members: {
      heading: "Meet your market",
      body: "These are the campus stores that might buy from you. Browse the directory to find the right contacts.",
      ctaLabel: "Browse members",
      targetPath: "/members",
      completesOnCta: true,
      guided: false,
    },
    network_partners: {
      heading: "See how you show up",
      body: "This is the directory members use to find vendors. Check how your company appears.",
      ctaLabel: "Browse partners",
      targetPath: "/partners",
      completesOnCta: true,
      guided: false,
    },
    events_discovery: {
      heading: "Stay in the loop",
      body: "CSC runs conferences and events throughout the year. The right event puts you in front of the right buyers.",
      ctaLabel: "View upcoming events",
      targetPath: "/events",
      completesOnCta: true,
      guided: false,
    },
    my_market: {
      heading: "Your market is ready",
      body: "Scroll down to see the member stores matched to your categories.",
      ctaLabel: "See my market",
      targetPath: "#your-market",
      completesOnCta: true,
      guided: false,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Derive persona from org membership on the current page
// ─────────────────────────────────────────────────────────────────────────────

function deriveLocalPersona(
  organizations: Array<{ role: string; organization: { slug: string; type: string } }>,
  orgSlug: string,
  programs: MembershipProgramDef[]
): { persona: Persona | null; isOwnOrgPage: boolean } {
  const membership = organizations.find((o) => o.organization?.slug === orgSlug);
  if (!membership) return { persona: null, isOwnOrgPage: false };

  const persona = personaForMembership(
    { orgType: membership.organization?.type, role: membership.role },
    programs
  );

  return { persona, isOwnOrgPage: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase machine (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "intro" | "show-field" | "highlight-edit" | "highlight-field" | "done";

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OrgOnboardingCallout({ orgSlug }: OrgOnboardingCalloutProps) {
  if (process.env.NEXT_PUBLIC_DISABLE_ONBOARDING === "true") return null;

  const { user, organizations, programs, isLoading } = useAuth();

  const { persona, isOwnOrgPage } = deriveLocalPersona(
    organizations as any[],
    orgSlug,
    programs
  );

  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [showTour, setShowTour] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const fieldHighlightRef = useRef<Element | null>(null);

  // Find first incomplete step that has a config
  useEffect(() => {
    if (isLoading || !user || !isOwnOrgPage || !persona) return;
    let cancelled = false;

    async function findActiveStep() {
      const steps = STEPS_BY_PERSONA[persona!] as readonly string[];
      const configs = CONFIGS[persona!];

      for (const stepKey of steps) {
        // toolkit_tour is handled by the tour modal, not the callout bubble
        if (stepKey === "toolkit_tour") {
          const result = await getOnboardingStep(stepKey as any, persona!);
          if (cancelled) return;
          if (result.success && (!result.step || !result.step.completed_at)) {
            // Show the tour modal for this step
            setShowTour(true);
            return;
          }
          continue;
        }

        // session_1_welcome is handled by OnboardingGate
        if (stepKey === "session_1_welcome") continue;

        // Skip steps without a callout config
        if (!configs[stepKey]) continue;

        const result = await getOnboardingStep(stepKey as any, persona!);
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
  }, [isLoading, user?.id, isOwnOrgPage, persona, refreshTick]);

  // Phase: show-field → FAB click or showFieldTrigger → highlight-edit (or complete)
  useEffect(() => {
    if (phase !== "show-field" || !activeStep || !persona) return;
    const config = CONFIGS[persona][activeStep];

    // Optionally pulse the Toolkit FAB to draw attention
    let fabEl: Element | null = null;
    if (config?.highlightFabInShowField) {
      fabEl = document.querySelector("[data-toolkit-fab]");
      if (fabEl) {
        fabEl.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "animate-pulse", "rounded-full");
      }
    }

    function onFabClick(e: MouseEvent) {
      if ((e.target as HTMLElement).closest("[data-toolkit-fab]")) {
        // Remove pulse before acting
        if (fabEl) {
          fabEl.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "animate-pulse", "rounded-full");
        }
        if (config?.completesOnFabClick) {
          void markComplete();
        } else {
          setPhase("highlight-edit");
        }
      }
    }
    document.addEventListener("click", onFabClick, { capture: true });

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
      if (fabEl) {
        fabEl.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "animate-pulse", "rounded-full");
      }
    };
  }, [phase, activeStep, persona]);

  // Phase: highlight-edit → pulse Edit button, wait for edit mode
  useEffect(() => {
    if (phase !== "highlight-edit" || !activeStep || !persona) return;
    const config = CONFIGS[persona][activeStep];

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
  }, [phase, activeStep, persona]);

  // Phase: highlight-field → pulse target element
  useEffect(() => {
    if (phase !== "highlight-field" || !activeStep || !persona) return;
    const config = CONFIGS[persona][activeStep];
    if (!config?.targetAttr) return;

    const el = document.querySelector(`[data-onboarding="${config.targetAttr}"]`);
    if (el) {
      el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse");
      fieldHighlightRef.current = el;
    }

    return () => {
      if (fieldHighlightRef.current) {
        fieldHighlightRef.current.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse");
        fieldHighlightRef.current = null;
      }
    };
  }, [phase, activeStep, persona]);

  // Always listen for field saves to complete the current step
  const handleFieldUpdated = useCallback(
    (e: Event) => {
      if (!activeStep || !persona) return;
      const config = CONFIGS[persona][activeStep];
      if (!config?.completionTrigger) return;
      const { table, column } = (e as CustomEvent<{ table: string; column: string }>).detail;
      const triggers = Array.isArray(config.completionTrigger)
        ? config.completionTrigger
        : [config.completionTrigger];
      if (triggers.some((t) => t.table === table && t.column === column)) {
        void markComplete();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStep, persona]
  );

  useEffect(() => {
    window.addEventListener("csc:field-updated", handleFieldUpdated);
    return () => window.removeEventListener("csc:field-updated", handleFieldUpdated);
  }, [handleFieldUpdated]);

  async function markComplete() {
    if (!activeStep || !persona) return;
    const completingStep = activeStep;
    if (fieldHighlightRef.current) {
      fieldHighlightRef.current.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded", "animate-pulse");
      fieldHighlightRef.current = null;
    }
    try {
      await completeOnboardingStep(completingStep as any, persona);
    } catch { /* non-fatal */ }
    setPhase("done");
    setActiveStep(null);
    // Toolkit tour fires after the first guided edit for org admins
    if (completingStep === "public_contact_email") {
      setShowTour(true);
    } else {
      setRefreshTick((t) => t + 1);
    }
  }

  async function handleCta() {
    if (!activeStep || !persona) return;
    const config = CONFIGS[persona][activeStep];
    if (!config) return;

    // Acknowledge-only step: complete with no navigation
    if (config.completesOnCta && !config.targetPath) {
      await markComplete();
      return;
    }

    // Navigation step: complete and navigate
    if (config.completesOnCta && config.targetPath) {
      await markComplete();
      if (config.targetPath.startsWith("#")) {
        document.querySelector(config.targetPath)?.scrollIntoView({ behavior: "smooth" });
      } else {
        window.location.assign(config.targetPath);
      }
      return;
    }

    // Scroll-to step
    const el = document.querySelector(`[data-onboarding="${config.targetAttr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (config.guided) {
        el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded");
        setTimeout(() => el.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-4", "rounded"), 2500);
      } else {
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

  // Toolkit tour modal
  if (showTour) {
    return (
      <ToolkitTourModal
        persona={persona}
        onDone={async () => {
          if (persona) {
            try { await completeOnboardingStep("toolkit_tour" as any, persona); } catch { /* non-fatal */ }
          }
          setShowTour(false);
          setRefreshTick((t) => t + 1);
        }}
      />
    );
  }

  const bubbleVisible = phase === "intro" || phase === "show-field";
  if (!activeStep || !persona || phase === "done" || !bubbleVisible) return null;

  const config = CONFIGS[persona][activeStep];
  if (!config) return null;

  const heading = phase === "intro" ? config.heading : (config.fieldHeading ?? config.heading);
  const body = phase === "intro" ? config.body : (config.fieldBody ?? config.body);

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

        <p className="text-[10px] font-semibold text-[#EE2A2E] uppercase tracking-widest mb-1">Getting started</p>
        <p className="text-sm font-semibold leading-snug pr-5 mb-1">{heading}</p>
        <p className="text-xs text-white/70 leading-snug mb-3">{body}</p>

        {phase === "intro" && (
          <button
            onClick={() => void handleCta()}
            className="w-full py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {config.ctaLabel}
          </button>
        )}

        {phase === "show-field" && (
          <div className="absolute -bottom-2 right-6 w-4 h-2 overflow-hidden">
            <div className="w-3 h-3 bg-[#1A1A1A] rotate-45 translate-y-[-50%] ml-0.5" />
          </div>
        )}
      </div>
    </div>
  );
}
