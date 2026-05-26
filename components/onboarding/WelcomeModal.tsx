"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  getOnboardingStep,
  initOrgAdminJourney,
  completeOnboardingStep,
} from "@/lib/actions/onboarding";

/**
 * WelcomeModal — Session 1 of the org admin onboarding journey.
 *
 * Appears once, on first login, for any user who has the org_admin role.
 * Sets the authority framing: you're the steward of your institution's
 * presence on this platform. You have real tools. Here's where to start.
 *
 * Completing OR dismissing the modal marks session_1_welcome as done —
 * so it never shows again, but the rest of the journey continues.
 */
export default function WelcomeModal() {
  const { user, profile, organizations, isLoading } = useAuth();
  const router = useRouter();

  const [visible, setVisible] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Find the org admin membership
  const orgAdminMembership = organizations.find((o) => o.role === "org_admin");
  const orgName = orgAdminMembership?.organization?.name ?? null;
  const orgSlug = orgAdminMembership?.organization?.slug ?? null;
  const displayName = profile?.display_name
    ? profile.display_name.split(" ")[0] // first name only
    : null;

  useEffect(() => {
    // Don't run until auth has settled and we know they're an org admin
    if (isLoading || !user || !orgAdminMembership) return;

    let cancelled = false;

    async function checkAndShow() {
      try {
        // Init the journey first (idempotent — safe if already done)
        await initOrgAdminJourney();

        // Check if session 1 has already been seen
        const result = await getOnboardingStep("session_1_welcome");
        if (cancelled) return;

        if (result.success && (!result.step || !result.step.completed_at)) {
          setVisible(true);
        }
      } catch {
        // Non-fatal — if the check fails, don't show the modal
      }
    }

    void checkAndShow();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user?.id, orgAdminMembership?.organization_id]);

  async function handleComplete(destination: string | null) {
    if (completing) return;
    setCompleting(true);

    try {
      await completeOnboardingStep("session_1_welcome");
    } catch {
      // Non-fatal — don't block the user
    }

    setVisible(false);

    if (destination) {
      router.push(destination);
    }
  }

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={() => void handleComplete(null)}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Top accent bar */}
          <div className="h-1.5 w-full bg-[#EE2A2E] rounded-t-2xl" />

          <div className="px-8 pt-8 pb-8">

            {/* Dismiss */}
            <div className="flex justify-end mb-2">
              <button
                onClick={() => void handleComplete(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-100"
                aria-label="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Greeting */}
            <p className="text-xs font-semibold text-[#EE2A2E] uppercase tracking-widest mb-3">
              Welcome to CSC
            </p>

            <h1 id="welcome-title" className="text-2xl font-bold text-[#1A1A1A] leading-snug mb-4">
              {displayName
                ? <>Hey {displayName}. You&rsquo;re in.</>
                : <>You&rsquo;re in.</>
              }
            </h1>

            <div className="space-y-3 text-[15px] text-[#4b4b4b] leading-relaxed">
              {orgName && (
                <p>
                  You&rsquo;re managing <strong className="text-[#1A1A1A]">{orgName}&rsquo;s</strong> presence
                  on the CSC network.
                </p>
              )}
              <p>
                That means you decide what your members see, what vendor partners
                see, and what the public knows about your institution.
              </p>
              <p>
                You have the tools to change any of it — right now, from any page,
                without emailing anyone.
              </p>
            </div>

            {/* Divider */}
            <div className="my-6 border-t border-gray-100" />

            {/* CTA */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => void handleComplete(orgSlug ? `/org/${orgSlug}` : null)}
                disabled={completing}
                className="w-full py-3 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {completing ? (
                  "One moment…"
                ) : (
                  <>
                    Show me my org page
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </>
                )}
              </button>

              <button
                onClick={() => void handleComplete(null)}
                disabled={completing}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-60"
              >
                I&rsquo;ll explore on my own
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
