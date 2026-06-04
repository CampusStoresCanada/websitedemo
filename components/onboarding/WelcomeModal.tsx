"use client";

import { useState } from "react";
import { completeOnboardingStep } from "@/lib/actions/onboarding";
import type { Persona } from "@/lib/onboarding/steps";

interface WelcomeModalProps {
  displayName: string | null;
  orgName: string | null;
  orgSlug: string | null;
  persona: Persona;
  onDone: () => void;
}

interface PersonaCopy {
  body: string[];
  ctaPrimary: string;
  ctaSecondary: string;
}

function getCopy(persona: Persona, orgName: string | null): PersonaCopy {
  const org = orgName ? `${orgName}'s` : "your organization's";

  switch (persona) {
    case "org_admin_member":
      return {
        body: [
          `You're managing ${org} presence on the CSC network.`,
          "That means you decide what your members see, what vendor partners see, and what the public knows about your institution.",
          "You have the tools to change any of it — right now, from any page, without emailing anyone.",
        ],
        ctaPrimary: "Show me my org page",
        ctaSecondary: "I'll explore on my own",
      };

    case "org_admin_partner":
      return {
        body: [
          `You're managing ${org} presence on the CSC network.`,
          "That means you decide what member stores see when they look you up — your catalogue, your contacts, your categories.",
          "You have the tools to shape all of it — right now, from any page.",
        ],
        ctaPrimary: "Show me my org page",
        ctaSecondary: "I'll explore on my own",
      };

    case "member_member":
      return {
        body: [
          orgName
            ? `You're part of ${orgName}'s team on the CSC network.`
            : "You're now on the CSC network.",
          "This is where campus stores across Canada connect, find suppliers, and stay ahead of the industry.",
          "Your profile is already here — and so is your market.",
        ],
        ctaPrimary: "Show me around",
        ctaSecondary: "I'll find my way",
      };

    case "member_partner":
      return {
        body: [
          orgName
            ? `You're part of ${orgName}'s team on the CSC network.`
            : "You're now on the CSC network.",
          "This is where campus stores come to find vendors. Your company's profile is here — and so are the buyers.",
          "Let's make sure they can find the right person.",
        ],
        ctaPrimary: "Show me around",
        ctaSecondary: "I'll find my way",
      };
  }
}

export default function WelcomeModal({
  displayName,
  orgName,
  orgSlug,
  persona,
  onDone,
}: WelcomeModalProps) {
  const [completing, setCompleting] = useState(false);
  const copy = getCopy(persona, orgName);

  async function handleComplete(destination: string | null) {
    if (completing) return;
    setCompleting(true);
    try {
      await completeOnboardingStep("session_1_welcome", persona);
    } catch {
      // Non-fatal
    }
    onDone();
    if (destination) {
      window.location.assign(destination);
    }
  }

  const primaryDestination = orgSlug ? `/org/${orgSlug}` : null;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={() => void handleComplete(null)}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">

          <div className="h-1.5 w-full bg-[#EE2A2E] rounded-t-2xl" />

          <div className="px-8 pt-8 pb-8">

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

            <p className="text-xs font-semibold text-[#EE2A2E] uppercase tracking-widest mb-3">
              Welcome to CSC
            </p>

            <h1 id="welcome-title" className="text-2xl font-bold text-[#1A1A1A] leading-snug mb-4">
              {displayName ? <>Hey {displayName}. You&rsquo;re in.</> : <>You&rsquo;re in.</>}
            </h1>

            <div className="space-y-3 text-[15px] text-[#4b4b4b] leading-relaxed">
              {copy.body.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>

            <div className="my-6 border-t border-gray-100" />

            <div className="flex flex-col gap-3">
              <button
                onClick={() => void handleComplete(primaryDestination)}
                disabled={completing}
                className="w-full py-3 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {completing ? "One moment…" : (
                  <>
                    {copy.ctaPrimary}
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
                {copy.ctaSecondary}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
