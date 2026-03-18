"use client";

import { useState } from "react";

type JoinType = null | "member" | "partner";

/**
 * Stub component for new member/partner organization applications.
 * This will be fleshed out with detailed forms later — for now it collects
 * basic info and explains the process.
 */
export default function JoinCSCFlow() {
  const [joinType, setJoinType] = useState<JoinType>(null);

  if (!joinType) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Join CSC</h3>
        <p className="text-sm text-gray-600">
          Campus Stores Canada welcomes new members and partners. Choose the
          option that best describes your organization:
        </p>

        <button
          onClick={() => setJoinType("member")}
          className="w-full flex items-start gap-4 p-4 rounded-lg border border-gray-200 hover:border-[#EE2A2E] hover:bg-red-50/50 text-left transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              className="w-5 h-5 text-[#EE2A2E]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342"
              />
            </svg>
          </div>
          <div>
            <p className="font-medium text-gray-900">Become a Member</p>
            <p className="text-sm text-gray-600 mt-1">
              For campus stores at Canadian post-secondary institutions.
              Membership includes access to benchmarking, professional
              development, and our vendor partner network.
            </p>
          </div>
        </button>

        <button
          onClick={() => setJoinType("partner")}
          className="w-full flex items-start gap-4 p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50/50 text-left transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              className="w-5 h-5 text-[#EE2A2E]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </div>
          <div>
            <p className="font-medium text-gray-900">Become a Partner</p>
            <p className="text-sm text-gray-600 mt-1">
              For vendors and service providers to the campus store industry.
              Partner with us to reach campus stores across Canada.
            </p>
          </div>
        </button>
      </div>
    );
  }

  // Stub forms — to be replaced with detailed forms later
  return (
    <div className="space-y-4">
      <button
        onClick={() => setJoinType(null)}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back
      </button>

      <h3 className="text-lg font-semibold text-gray-900">
        {joinType === "member"
          ? "Member Application"
          : "Partner Application"}
      </h3>

      <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
        <p className="text-sm text-blue-800">
          {joinType === "member" ? (
            <>
              Thank you for your interest in CSC membership! The full
              application process will collect information about your
              institution, store operations, and contact details. For now,
              please create an account above and we&apos;ll be in touch to
              complete your application.
            </>
          ) : (
            <>
              Thank you for your interest in becoming a CSC Vendor Partner!
              The full application will cover your company profile, product
              categories, and partnership terms. For now, please create an
              account above and we&apos;ll reach out with next steps.
            </>
          )}
        </p>
      </div>

      <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
        <p className="text-xs text-gray-600">
          <span className="font-medium">What happens next:</span>
        </p>
        <ol className="mt-2 space-y-1 text-xs text-gray-600 list-decimal list-inside">
          <li>Create your account using the form above</li>
          <li>A CSC administrator will review your application</li>
          <li>You&apos;ll receive an email when you&apos;re approved</li>
          <li>
            Once approved, you&apos;ll have full access to the CSC network
          </li>
        </ol>
      </div>
    </div>
  );
}
