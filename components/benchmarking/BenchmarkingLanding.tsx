"use client";

import Link from "next/link";
import type { BenchmarkingSurvey } from "@/lib/database.types";
import { useAuth } from "@/components/providers/AuthProvider";
import { parseUTC } from "@/lib/utils";

interface BenchmarkingLandingProps {
  surveys: BenchmarkingSurvey[];
  userOrgInfo: {
    organizationId: string;
    organizationName: string;
    orgSlug: string | null;
    isOrgAdmin: boolean;
  } | null;
  existingDraft: {
    id: string;
    status: string;
    fiscalYear: number;
    updatedAt: string | null;
  } | null;
}

export default function BenchmarkingLanding({
  surveys,
  userOrgInfo,
  existingDraft,
}: BenchmarkingLandingProps) {
  const { user, permissionState, organizations, isBenchmarkingReviewer } = useAuth();

  const isAdmin = permissionState === "admin" || permissionState === "super_admin";
  const hasAdminAccess = isAdmin || isBenchmarkingReviewer;
  const activeSurvey = surveys.find((s) => s.status === "open");
  const latestSurvey = surveys[0];

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      {/* Admin / Reviewer link */}
      {hasAdminAccess && (
        <div className="mb-6 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-purple-700 font-medium">
            {isAdmin
              ? "You have admin access to the benchmarking system."
              : "You have reviewer access to the benchmarking system."}
          </span>
          <Link
            href={isAdmin ? "/benchmarking/admin" : "/benchmarking/admin/submissions"}
            className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            {isAdmin ? "Admin Dashboard" : "Review Submissions"}
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          Annual Benchmarking Survey
        </h1>
        <p className="text-lg text-gray-600">
          The CSC Benchmarking Survey collects operational and financial data from
          member campus stores across Canada, enabling peer comparison and
          data-driven decision making.
        </p>
      </div>

      {/* Survey Status Card */}
      {latestSurvey && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {latestSurvey.title}
            </h2>
            <SurveyStatusBadge status={latestSurvey.status ?? "draft"} />
          </div>

          {latestSurvey.status === "open" && (
            <div className="text-sm text-gray-600">
              {latestSurvey.closes_at && (
                <p>
                  Closes:{" "}
                  {parseUTC(latestSurvey.closes_at).toLocaleDateString("en-CA", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          )}

          {latestSurvey.status === "complete" && (
            <p className="text-sm text-gray-600">
              This survey has been completed. Results are available in your
              organization profile.
            </p>
          )}

          {(latestSurvey.status === "draft" || latestSurvey.status === "closed") && (
            <p className="text-sm text-gray-600">
              {latestSurvey.status === "draft"
                ? "This survey is being prepared and will open soon."
                : "This survey has closed for submissions. Results are being processed."}
            </p>
          )}
        </div>
      )}

      {/* Action Area */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {!user ? (
          /* Not logged in */
          <div className="text-center py-4">
            <p className="text-gray-600 mb-4">
              Sign in with your CSC member account to access the benchmarking survey.
            </p>
            <Link
              href="/login"
              className="inline-block px-6 py-2.5 bg-[#EE2A2E] text-white rounded-lg font-medium hover:bg-[#D92327] transition-colors"
            >
              Sign In
            </Link>
          </div>
        ) : !userOrgInfo ? (
          /* Logged in but not associated with a member org */
          <div className="text-center py-4">
            <p className="text-gray-600">
              The benchmarking survey is available to CSC member organizations.
              Your account is not currently associated with a member store.
            </p>
          </div>
        ) : !userOrgInfo.isOrgAdmin ? (
          /* Member but not org_admin */
          <div className="text-center py-4">
            <p className="text-gray-600">
              The benchmarking survey can be completed by your organization&apos;s
              admin. Contact your admin at{" "}
              <span className="font-medium">{userOrgInfo.organizationName}</span>{" "}
              to submit the survey.
            </p>
          </div>
        ) : !activeSurvey ? (
          /* Org admin but no open survey */
          <div className="text-center py-4">
            <p className="text-gray-600">
              There is no survey currently open for submissions.
              {latestSurvey?.status === "draft" &&
                " The next survey is being prepared."}
            </p>
          </div>
        ) : (
          /* Org admin with open survey — show action */
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {userOrgInfo.organizationName}
                </h3>
                {existingDraft ? (
                  <p className="text-sm text-gray-600 mt-1">
                    {existingDraft.status === "submitted" ? (
                      <span className="text-green-700">
                        Survey submitted
                        {existingDraft.updatedAt &&
                          ` on ${parseUTC(existingDraft.updatedAt).toLocaleDateString("en-CA")}`}
                      </span>
                    ) : (
                      <span className="text-amber-700">
                        Draft in progress
                        {existingDraft.updatedAt &&
                          ` — last saved ${parseUTC(existingDraft.updatedAt).toLocaleDateString("en-CA")}`}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 mt-1">
                    You haven&apos;t started the FY{activeSurvey.fiscal_year} survey yet.
                  </p>
                )}
              </div>

              <Link
                href="/benchmarking/survey"
                className="inline-block px-6 py-2.5 bg-[#EE2A2E] text-white rounded-lg font-medium hover:bg-[#D92327] transition-colors"
              >
                {existingDraft
                  ? existingDraft.status === "submitted"
                    ? "View Submission"
                    : "Continue Survey"
                  : "Start Survey"}
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        <div className="text-center">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Confidential</h3>
          <p className="text-sm text-gray-600">
            All data is confidential. Only aggregated results are shared publicly.
          </p>
        </div>
        <div className="text-center">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Peer Comparison</h3>
          <p className="text-sm text-gray-600">
            Compare your store&apos;s performance against peers by size, region, and type.
          </p>
        </div>
        <div className="text-center">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Auto-Save</h3>
          <p className="text-sm text-gray-600">
            Your progress is saved automatically. Complete the survey at your own pace.
          </p>
        </div>
      </div>
    </div>
  );
}

function SurveyStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    open: "bg-green-100 text-green-800",
    closed: "bg-amber-100 text-amber-800",
    processing: "bg-blue-100 text-blue-800",
    complete: "bg-gray-100 text-gray-700",
  };

  const labels: Record<string, string> = {
    draft: "Coming Soon",
    open: "Open",
    closed: "Closed",
    processing: "Processing",
    complete: "Complete",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        styles[status] || styles.draft
      }`}
    >
      {status === "open" && (
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5" />
      )}
      {labels[status] || status}
    </span>
  );
}
