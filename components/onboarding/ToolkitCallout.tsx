"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

const STORAGE_KEY = "csc_toolkit_callout_dismissed";

interface ToolkitCalloutProps {
  /** The slug of the org page currently being viewed */
  orgSlug: string;
}

/**
 * ToolkitCallout — a one-time contextual hint on the org page.
 *
 * Points at the Toolkit FAB (fixed bottom-right) and says
 * "This follows you everywhere. Try it."
 *
 * Shown once: when an org admin lands on their own org page for the
 * first time after completing the welcome modal. Dismissed via the X,
 * by clicking the CTA, or by opening the Toolkit itself.
 *
 * State is stored in localStorage — it's a UI hint, not a journey milestone.
 * If the admin resets someone's journey, clear localStorage on their device.
 */
export default function ToolkitCallout({ orgSlug }: ToolkitCalloutProps) {
  const { user, organizations, isLoading } = useAuth();
  const [visible, setVisible] = useState(false);

  const isOwnOrgPage = organizations.some(
    (o) => o.role === "org_admin" && o.organization.slug === orgSlug
  );

  useEffect(() => {
    if (isLoading || !user || !isOwnOrgPage) return;

    // Only show if not already dismissed
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) {
        // Small delay so the page has settled before the callout pops
        const t = setTimeout(() => setVisible(true), 1200);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage unavailable — skip silently
    }
  }, [isLoading, user, isOwnOrgPage]);

  // Also dismiss if the user opens the Toolkit themselves
  useEffect(() => {
    if (!visible) return;

    function onToolkitOpen(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // The Toolkit FAB is the only fixed button at bottom-right with z-50
      // We detect it by checking if the click target is inside the Toolkit area
      if (target.closest("[data-toolkit-fab]")) {
        dismiss();
      }
    }

    document.addEventListener("click", onToolkitOpen, { capture: true });
    return () => document.removeEventListener("click", onToolkitOpen, { capture: true });
  }, [visible]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // silent
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="tooltip"
    >
      <div className="relative bg-[#1A1A1A] text-white rounded-xl shadow-xl px-4 py-3 max-w-[220px]">

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

        <p className="text-sm font-semibold leading-snug pr-5">
          This follows you everywhere.
        </p>
        <p className="text-xs text-white/70 mt-1">
          Your Toolkit. Try it.
        </p>

        {/* Arrow pointing down toward the Toolkit FAB */}
        <div className="absolute -bottom-2 right-6 w-4 h-2 overflow-hidden">
          <div className="w-3 h-3 bg-[#1A1A1A] rotate-45 translate-y-[-50%] ml-0.5" />
        </div>
      </div>
    </div>
  );
}
