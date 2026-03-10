"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Benchmarking, DeltaFlag } from "@/lib/database.types";
import { verifySubmission, unverifySubmission } from "@/lib/actions/benchmarking-admin";
import SurveySection1 from "@/components/benchmarking/sections/SurveySection1";
import SurveySection2 from "@/components/benchmarking/sections/SurveySection2";
import SurveySection3 from "@/components/benchmarking/sections/SurveySection3";
import SurveySection4 from "@/components/benchmarking/sections/SurveySection4";
import SurveySection5 from "@/components/benchmarking/sections/SurveySection5";
import SurveySection6 from "@/components/benchmarking/sections/SurveySection6";
import SurveySection7 from "@/components/benchmarking/sections/SurveySection7";
import SurveySection8 from "@/components/benchmarking/sections/SurveySection8";

const SECTIONS = [
  { id: 1, title: "Institution Profile" },
  { id: 2, title: "Sales Revenue" },
  { id: 3, title: "Financial Metrics" },
  { id: 4, title: "Staffing" },
  { id: 5, title: "Course Materials" },
  { id: 6, title: "General Merchandise" },
  { id: 7, title: "Technology & Systems" },
  { id: 8, title: "Store Operations" },
] as const;

interface SubmissionDetailProps {
  submission: Benchmarking;
  organizationName: string;
  organizationProvince: string;
  deltaFlags: DeltaFlag[];
  priorYearData: Benchmarking | null;
}

export default function SubmissionDetail({
  submission,
  organizationName,
  organizationProvince,
  deltaFlags,
  priorYearData,
}: SubmissionDetailProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState(1);
  const [verifying, setVerifying] = useState(false);

  const isVerified = !!submission.verified_by;
  const formData = submission as unknown as Record<string, unknown>;
  const priorData = priorYearData as unknown as Record<string, unknown> | null;

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

  // No-op handlers for read-only sections
  const noopFieldChange = () => {};
  const noopDeltaFlag = async () => {};

  const sectionProps = {
    formData,
    priorYearData: priorData,
    onFieldChange: noopFieldChange,
    onDeltaFlag: noopDeltaFlag,
    deltaFlags,
    isReadOnly: true,
    organizationName,
    organizationProvince,
  };

  const SectionComponent = [
    SurveySection1,
    SurveySection2,
    SurveySection3,
    SurveySection4,
    SurveySection5,
    SurveySection6,
    SurveySection7,
    SurveySection8,
  ][activeSection - 1];

  const pendingFlags = deltaFlags.filter((f) => f.committee_status === "pending").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/benchmarking/admin/submissions"
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
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
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
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {verifying ? "..." : isVerified ? "Remove Verification" : "Mark as Verified"}
          </button>
        )}
      </div>

      {/* Section nav */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeSection === s.id
                ? "bg-[#D60001] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s.id}. {s.title}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <SectionComponent {...sectionProps} />
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
