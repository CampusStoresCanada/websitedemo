"use client";

import { useState } from "react";
import { completeOnboardingStep } from "@/lib/actions/onboarding";

interface ToolkitTourModalProps {
  onDone: () => void;
  /** The viewer's persona — used to filter which tools are most relevant */
  persona?: string | null;
}

// Icons and colours match the Toolkit exactly — same SVG paths, same mode-button colours.
const TOOLS = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Edit",
    description: "Your profile is yours to shape. Fix anything that's wrong, fill in what's missing, and keep your store's presence current.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Flag",
    description: "See something off on another organization's page? Flag it and we'll make sure it gets reviewed and corrected.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Explain",
    description: "Not sure what something means on a page? Ask for an explanation and get context from the people who know.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Share",
    description: "Found something worth passing along? Share any page or profile directly with a colleague in one click.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Export",
    description: "Pull a dataset from any page for your own records, reporting, or analysis. The data is yours.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
    ),
    color: "bg-white text-gray-600 border border-gray-200",
    name: "Bookmark",
    description: "Save any page you want to find again quickly. Your bookmarks follow you across the whole network.",
  },
];

export default function ToolkitTourModal({ onDone, persona }: ToolkitTourModalProps) {
  const [completing, setCompleting] = useState(false);

  async function handleDone() {
    if (completing) return;
    setCompleting(true);
    // Completion is handled by the caller (OrgOnboardingCallout or WelcomeModal)
    // so it can pass the correct persona. Just call onDone.
    onDone();
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm animate-in fade-in duration-300" />

      {/* Modal */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Top accent */}
          <div className="h-1.5 w-full bg-[#EE2A2E] rounded-t-2xl" />

          <div className="px-8 pt-7 pb-8">
            <p className="text-xs font-semibold text-[#EE2A2E] uppercase tracking-widest mb-2">
              Your Toolkit
            </p>
            <h2 className="text-xl font-bold text-[#1A1A1A] leading-snug mb-1">
              And now the rest of the story.
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              That + button follows you everywhere on the network. Here's everything it can do.
            </p>

            <div className="grid grid-cols-1 gap-3 mb-7">
              {TOOLS.filter(tool =>
                // Member personas don't have Edit access — skip that tool for them
                !(tool.name === "Edit" && (persona === "member_member" || persona === "member_partner"))
              ).map((tool) => (
                <div key={tool.name} className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tool.color}`}>
                    {tool.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1A1A1A] leading-tight">{tool.name}</p>
                    <p className="text-xs text-gray-500 leading-snug mt-0.5">{tool.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleDone}
              disabled={completing}
              className="w-full py-3 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {completing ? "One moment…" : "Got it — I'm ready to explore"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
