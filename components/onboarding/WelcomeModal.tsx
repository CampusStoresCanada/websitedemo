"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeOnboardingStep } from "@/lib/actions/onboarding";

interface WelcomeModalProps {
  displayName: string | null;
  orgName: string | null;
  orgSlug: string | null;
  onDone: () => void;
}

/**
 * WelcomeModal — pure UI component for Session 1 of the org admin journey.
 * All visibility / DB-check logic lives in OnboardingGate.
 * This just renders the modal and calls onDone when the user dismisses it.
 */
export default function WelcomeModal({ displayName, orgName, orgSlug, onDone }: WelcomeModalProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);

  async function handleComplete(destination: string | null) {
    if (completing) return;
    setCompleting(true);

    try {
      await completeOnboardingStep("session_1_welcome");
    } catch {
      // Non-fatal — don't block the user
    }

    onDone();

    if (destination) {
      router.push(destination);
    }
  }

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
