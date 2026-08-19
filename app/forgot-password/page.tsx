"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { initiateAccountRecovery } from "@/lib/actions/account-recovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notRecognized, setNotRecognized] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where the user was headed before they hit the login wall. Carried through
  // the reset so someone who arrives from a board-vote button (or any other
  // deep link) is returned to it rather than dropped on /onboarding having
  // forgotten what they were doing. Only same-site paths are honoured.
  const rawNext = searchParams.get("next");
  const nextPath = rawNext && rawNext.startsWith("/") ? rawNext : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotRecognized(false);

    // Handles both a real forgotten-password reset and first-time setup for
    // someone who's already a recognized contact at a member/partner org but
    // has never logged in here before -- checks account/contact state
    // server-side, silently provisions a first-time account when there's a
    // contact match, then sends the same 6-digit code (Supabase {{ .Token }})
    // either way. No magic link, so Exchange/ATP Safe Links can't pre-click
    // and burn the token. The user enters the code on /reset-password, which
    // we hand the email to so they don't have to re-type it.
    const result = await initiateAccountRecovery(email);

    if (result.outcome === "not_recognized") {
      setNotRecognized(true);
      setIsLoading(false);
      return;
    }

    if (result.outcome === "error") {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    router.push(
      `/reset-password?email=${encodeURIComponent(email)}` +
        (nextPath ? `&next=${encodeURIComponent(nextPath)}` : "")
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Reset your password
            </h1>
            <p className="text-gray-600">
              Enter your email and we&apos;ll send you a 6-digit code. If this is
              your first time signing in, we&apos;ll set up your account too.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {notRecognized ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
                <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 17.25h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                We don&apos;t recognize that email
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                We couldn&apos;t find an account or an existing member/partner
                contact for <span className="font-medium text-gray-900">{email}</span>.
                New to Campus Stores Canada?
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  href="/membership"
                  className="inline-flex items-center justify-center px-6 py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] transition-colors"
                >
                  Become a Member
                </Link>
                <button
                  type="button"
                  onClick={() => setNotRecognized(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Try a different email
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E] transition-colors"
                  placeholder="you@yourschool.ca"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "Sending..." : "Send Code"}
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <Link
              href="/login"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
