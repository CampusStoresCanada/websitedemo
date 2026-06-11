"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { getOnboardingStep, initJourney, derivePersona } from "@/lib/actions/onboarding";
import type { Persona } from "@/lib/onboarding/steps";
import WelcomeModal from "@/components/onboarding/WelcomeModal";

interface OnboardingGateProps {
  children: React.ReactNode;
  /**
   * Server-side hint: does the current user have any org membership?
   * Used to skip the async check entirely for anonymous visitors.
   */
  serverHasOnboarding: boolean;
}

type GateState = "checking" | "modal" | "open";

export default function OnboardingGate({ children, serverHasOnboarding }: OnboardingGateProps) {
  const { user, profile, organizations, isLoading } = useAuth();

  const onboardingDisabled = process.env.NEXT_PUBLIC_DISABLE_ONBOARDING === "true";
  const [state, setState] = useState<GateState>(
    onboardingDisabled || !serverHasOnboarding ? "open" : "checking"
  );
  const [persona, setPersona] = useState<Persona | null>(null);

  // Reset the gate whenever the user changes (e.g. DevPanel account switch).
  // useState initializer only runs once so we need an effect to handle re-auth.
  // Always go back to "checking" — don't inspect organizations here because they
  // haven't loaded yet for the new user. The main check effect opens the gate
  // if the user has no qualifying memberships.
  useEffect(() => {
    if (onboardingDisabled) return;
    if (!user) { setState("open"); return; }
    setState("checking");
    setPersona(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (isLoading || state !== "checking") return;
    if (!user || organizations.length === 0) {
      setState("open");
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        // Init the journey (idempotent) and get the user's persona
        const initResult = await initJourney();
        if (cancelled) return;
        if (!initResult.success || !initResult.persona) {
          setState("open");
          return;
        }

        const p = initResult.persona;
        const result = await getOnboardingStep("session_1_welcome", p);
        if (cancelled) return;

        const needsModal = result.success && (!result.step || !result.step.completed_at);
        if (needsModal) {
          setPersona(p);
          setState("modal");
        } else {
          setState("open");
        }
      } catch (e) {
        console.error("[OnboardingGate] check failed:", e);
        if (!cancelled) setState("open");
      }
    }

    void check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, state, user?.id, organizations.length]);

  // Resolve display values for the modal
  const displayName = profile?.display_name ? profile.display_name.split(" ")[0] : null;
  const orgMembership = persona
    ? organizations.find((o) =>
        persona === "org_admin_member" || persona === "member_member"
          ? o.organization?.type === "Member"
          : o.organization?.type === "Vendor Partner"
      )
    : null;
  const orgName = orgMembership?.organization?.name ?? null;
  const orgSlug = orgMembership?.organization?.slug ?? null;

  return (
    <>
      {state === "modal" && persona && (
        <WelcomeModal
          displayName={displayName}
          orgName={orgName}
          orgSlug={orgSlug}
          persona={persona}
          onDone={() => setState("open")}
        />
      )}

      <div className={`transition-opacity duration-300 ${state === "open" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {children}
      </div>
    </>
  );
}
