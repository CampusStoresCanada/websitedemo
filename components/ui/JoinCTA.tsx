"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";

interface JoinCTAProps {
  /** Message to display. Defaults based on auth state. */
  message?: string;
  /** CTA button text. Defaults to "Join CSC" or "Sign In" based on auth. */
  ctaText?: string;
  /** Link destination. Defaults to "/login" or "/signup" based on auth. */
  ctaLink?: string;
  /** Compact mode for inline usage within tables/cards */
  compact?: boolean;
}

/**
 * Standalone CTA component for encouraging signups/sign-ins.
 * Uses useAuth() only to determine messaging (sign in vs join).
 */
export default function JoinCTA({
  message,
  ctaText,
  ctaLink,
  compact = false,
}: JoinCTAProps) {
  const { user } = useAuth();

  const defaultMessage = user
    ? "This information is available to CSC members"
    : "Sign in to view full details";

  const defaultCtaText = user ? "Join CSC" : "Sign In";
  const defaultCtaLink = user ? "/signup" : "/login";

  const resolvedMessage = message ?? defaultMessage;
  const resolvedCtaText = ctaText ?? defaultCtaText;
  const resolvedCtaLink = ctaLink ?? defaultCtaLink;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-gray-500">
        <svg
          className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        <Link
          href={resolvedCtaLink}
          className="text-[#D60001] hover:underline font-medium"
        >
          {resolvedCtaText}
        </Link>
      </span>
    );
  }

  return (
    <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200 rounded-lg flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center flex-shrink-0">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <p className="text-sm text-gray-600">{resolvedMessage}</p>
      </div>
      <Link
        href={resolvedCtaLink}
        className="flex-shrink-0 px-4 py-2 bg-[#1A1A1A] text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
      >
        {resolvedCtaText}
      </Link>
    </div>
  );
}
