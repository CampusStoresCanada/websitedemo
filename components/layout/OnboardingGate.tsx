"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, initOrgAdminJourney } from "@/lib/actions/onboarding";
import WelcomeModal from "@/components/onboarding/WelcomeModal";

interface OnboardingGateProps {
  children: React.ReactNode;
  /**
   * Server-side hint: is the current user an org admin?
   * Used to skip the async check entirely for non-org-admins,
   * so the gate never adds latency for ordinary visitors.
   */
  serverIsOrgAdmin: boolean;
}

type GateState = "checking" | "modal" | "open";

export default function OnboardingGate({ children, serverIsOrgAdmin }: OnboardingGateProps) {
  const { user, profile, organizations, isLoading } = useAuth();

  // Non-org-admins skip the gate entirely — start open immediately.
  const [state, setState] = useState<GateState>(serverIsOrgAdmin ? "checking" : "open");

  useEffect(() => {
    if (isLoading || state !== "checking") return;

    const orgAdminMembership = organizations.find((o) => o.role === "org_admin");
    if (!orgAdminMembership) {
      setState("open");
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        // Ensure the journey rows exist (idempotent)
        await initOrgAdminJourney();
        const result = await getOnboardingStep("session_1_welcome");
        if (cancelled) return;

        const needsModal = result.success && (!result.step || !result.step.completed_at);
        setState(needsModal ? "modal" : "open");
      } catch {
        // If the check fails for any reason, open the gate so the user isn't stuck
        if (!cancelled) setState("open");
      }
    }

    void check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, state, organizations]);

  const orgAdminMembership = organizations.find((o) => o.role === "org_admin");
  const displayName = profile?.display_name ? profile.display_name.split(" ")[0] : null;
  const orgName = orgAdminMembership?.organization?.name ?? null;
  const orgSlug = orgAdminMembership?.organization?.slug ?? null;

  return (
    <>
      {/* Modal renders outside the gated content so it's always on top */}
      {state === "modal" && (
        <WelcomeModal
          displayName={displayName}
          orgName={orgName}
          orgSlug={orgSlug}
          onDone={() => setState("open")}
        />
      )}

      {/*
       * Page content — rendered immediately so it loads in the background,
       * but invisible + non-interactive until the gate opens.
       * The opacity transition gives a clean fade-in after the modal clears.
       */}
      <div
        className={`transition-opacity duration-300 ${
          state === "open" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {children}
      </div>
    </>
  );
}
