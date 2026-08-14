"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, completeOnboardingStep } from "@/lib/actions/onboarding";
import { deriveGlobalPersona } from "@/lib/onboarding/persona";

interface DirectoryOnboardingCalloutProps {
  /** Which directory page this instance is on */
  page: "members" | "partners";
}

type SubPhase = "toggle" | "refine" | "institution" | "done";

export default function DirectoryOnboardingCallout({ page }: DirectoryOnboardingCalloutProps) {
  if (process.env.NEXT_PUBLIC_DISABLE_ONBOARDING === "true") return null;

  const { user, organizations, programs, isLoading } = useAuth();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [subPhase, setSubPhase] = useState<SubPhase>("toggle");
  const hasSeenMap = useRef(false);
  const persona = deriveGlobalPersona(
    (organizations as any[]).map((o) => ({ orgType: o.organization?.type, role: o.role })),
    programs
  );

  const stepKey = page === "members" ? "network_members" : "network_partners";

  // Check if this step is pending for the current user
  useEffect(() => {
    if (isLoading || !user || !persona) return;
    let cancelled = false;

    getOnboardingStep(stepKey as any, persona).then((result) => {
      if (cancelled) return;
      if (result.success && result.step && !result.step.completed_at) {
        setActive(true);
        setSubPhase("toggle");
        hasSeenMap.current = false;
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user?.id, persona]);

  // Phase 1: Listen for view mode changes
  useEffect(() => {
    if (!active || subPhase !== "toggle") return;

    function onViewChange(e: Event) {
      const mode = (e as CustomEvent<{ mode: string }>).detail.mode;
      if (mode === "map") {
        hasSeenMap.current = true;
      } else if (mode === "table" && hasSeenMap.current) {
        setSubPhase("refine");
      }
    }
    window.addEventListener("csc:view-mode-changed", onViewChange);
    return () => window.removeEventListener("csc:view-mode-changed", onViewChange);
  }, [active, subPhase]);

  // Phase 2: Listen for filter applied
  useEffect(() => {
    if (!active || subPhase !== "refine") return;

    function onFilterApplied() {
      setSubPhase("institution");
    }
    window.addEventListener("csc:filter-applied", onFilterApplied);
    return () => window.removeEventListener("csc:filter-applied", onFilterApplied);
  }, [active, subPhase]);

  // Phase 3: Watch for navigation to an org page
  useEffect(() => {
    if (!active || subPhase !== "institution") return;
    if (pathname.startsWith("/org/")) {
      // User clicked through to an org — complete the step
      void completeOnboardingStep(stepKey as any, persona!).catch(() => {});
      setActive(false);
      setSubPhase("done");
    }
  }, [active, subPhase, pathname, persona]);

  if (!active || subPhase === "done") return null;

  const copy: Record<SubPhase, { heading: string; body: string }> = {
    toggle: {
      heading: "Two ways to explore",
      body: "Switch between the map and list views using the icon at the top. Try switching back and forth — then come back to the list to continue.",
    },
    refine: {
      heading: "Narrow it down",
      body: "Use the Refine button to filter by province, scale, or other criteria. Try applying any filter.",
    },
    institution: {
      heading: "Dive into one",
      body: "Click any institution in the list to see their full profile — contacts, categories, and more.",
    },
    done: { heading: "", body: "" },
  };

  const targetAttr = subPhase === "toggle" ? "view-toggle"
    : subPhase === "refine" ? "refine-button"
    : null;

  function handleHighlight() {
    if (!targetAttr) return;
    const el = document.querySelector(`[data-onboarding="${targetAttr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "rounded-full", "animate-pulse");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#EE2A2E]", "ring-offset-2", "rounded-full", "animate-pulse"), 2500);
    }
  }

  const { heading, body } = copy[subPhase];

  return (
    <div
      className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="complementary"
      aria-label="Onboarding guidance"
    >
      <div className="relative bg-[#1A1A1A] text-white rounded-xl shadow-xl px-4 py-3 max-w-[260px]">
        <button
          onClick={() => setActive(false)}
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

        {targetAttr && (
          <button
            onClick={handleHighlight}
            className="w-full py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Show me
          </button>
        )}
      </div>
    </div>
  );
}
