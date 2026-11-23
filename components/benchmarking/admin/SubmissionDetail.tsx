"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Benchmarking, DeltaFlag } from "@/lib/types/db";
import { verifySubmission, unverifySubmission } from "@/lib/actions/benchmarking-admin";
import ReviewAllAnswers from "@/components/benchmarking/ReviewAllAnswers";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";
import type {
  OtherIncomeRow,
  OtherExpenseRow,
  StaffRow,
} from "@/lib/actions/benchmarking-financials";
import type { CompetitorRow } from "@/lib/actions/benchmarking-competitors";
import type { SurveyLocation } from "@/lib/actions/benchmarking-locations";
import type { KeyDate } from "@/lib/actions/benchmarking-profile";

/**
 * One store's submission, as the committee reads it.
 *
 * ⛔ Renders ReviewAllAnswers, the same screen the store saw before it filed.
 * Not a second renderer.
 *
 * It used to drive its own SurveySection1-8, written before the category
 * rebuild and never retired. Those sections asked for the flat `sales_*`,
 * `total_gross_sales_instore`, `total_cogs` and `net_profit` columns, which the
 * rebuild deliberately stopped writing — so on every FY2026 submission they
 * were empty, and CurrencyField helpfully prefilled last year's figure the way
 * it does for a store that is about to answer. The result, on all 13 submitted
 * stores: FY2025 revenue displayed as this year's, and this year's real
 * category sales shown nowhere, because that page never loaded them. Karin
 * Stonehouse reported it on 2026-11-23 against McMaster, where the screen was
 * showing $10,735,607 of in-store sales that belonged to FY2025.
 *
 * Reading the store's own config is what makes that class of drift impossible:
 * a question the store was never asked cannot appear here, and a figure it
 * never gave reads "Not answered".
 */

interface SubmissionDetailProps {
  submission: Benchmarking;
  organizationName: string;
  deltaFlags: DeltaFlag[];
  /** The config this store was actually asked, same source as the form. */
  config: SurveyFieldConfig;
  lists: {
    gmCategories: SurveyCategory[];
    cmCategories: SurveyCategory[];
    otherIncome: OtherIncomeRow[];
    otherExpenses: OtherExpenseRow[];
    staff: StaffRow[];
    competitors: CompetitorRow[];
    locations: SurveyLocation[];
    keyDates: KeyDate[];
  };
}

export default function SubmissionDetail({
  submission,
  organizationName,
  deltaFlags,
  config,
  lists,
}: SubmissionDetailProps) {
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);

  const isVerified = !!submission.verified_by;
  const formData = submission as unknown as Record<string, unknown>;

  const handleVerify = async () => {
    setVerifying(true);
    const result = isVerified
      ? await unverifySubmission(submission.id)
      : await verifySubmission(submission.id);
    if (result.success) {
      router.refresh();
    }
    setVerifying(false);
  };

  const pendingFlags = deltaFlags.filter((f) => f.committee_status === "pending").length;

  // Nobody is filling this in, so there is nowhere to jump to. readOnly hides
  // the controls that would call these.
  const noop = () => {};

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href={`/benchmarking/admin/${submission.fiscal_year}/submissions`}
            className="text-xs text-gray-500 hover:text-gray-700 mb-1 inline-block"
          >
            &larr; Back to Submissions
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{organizationName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">
              FY{submission.fiscal_year}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                submission.status === "submitted"
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {submission.status === "submitted" ? "Submitted" : "In Progress"}
            </span>
            {isVerified && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-[#D92327]">
                Verified
              </span>
            )}
            {pendingFlags > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                {pendingFlags} pending flag{pendingFlags !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {submission.status === "submitted" && (
          <button
            onClick={handleVerify}
            disabled={verifying}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
              isVerified
                ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
                : "bg-[#EE2A2E] text-white hover:bg-[#D92327]"
            }`}
          >
            {verifying ? "..." : isVerified ? "Remove Verification" : "Mark as Verified"}
          </button>
        )}
      </div>

      {/* The submission */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <ReviewAllAnswers
          config={config}
          formData={formData}
          fiscalYear={submission.fiscal_year}
          lists={lists}
          onJumpToField={noop}
          onJumpToSection={noop}
          onClose={noop}
          readOnly
        />
      </div>

      {/* Delta flags summary */}
      {deltaFlags.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Delta Flags ({deltaFlags.length})
          </h3>
          <div className="space-y-2">
            {deltaFlags.map((flag) => (
              <div
                key={flag.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-700">
                    {flag.field_name.replace(/_/g, " ")}
                  </span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-gray-500">
                    {flag.previous_value?.toLocaleString()} → {flag.current_value?.toLocaleString()}
                  </span>
                  {flag.pct_change !== null && (
                    <span className={`ml-2 text-xs font-medium ${
                      Math.abs(flag.pct_change) > 50 ? "text-red-600" : "text-amber-600"
                    }`}>
                      ({flag.pct_change > 0 ? "+" : ""}{flag.pct_change.toFixed(0)}%)
                    </span>
                  )}
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    flag.committee_status === "approved"
                      ? "bg-green-100 text-green-700"
                      : flag.committee_status === "rejected"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {flag.committee_status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
