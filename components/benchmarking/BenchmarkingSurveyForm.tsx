"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Benchmarking, DeltaFlag } from "@/lib/database.types";
import {
  saveBenchmarkingField,
  submitBenchmarkingSurvey,
  amendBenchmarkingSurvey,
  saveDeltaFlag,
} from "@/lib/actions/benchmarking-survey";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import DynamicSurveySection from "./DynamicSurveySection";
import { parseUTC } from "@/lib/utils";

interface BenchmarkingSurveyFormProps {
  benchmarkingId: string;
  fiscalYear: number;
  organizationName: string;
  organizationProvince: string;
  currentData: Benchmarking;
  priorYearData: Benchmarking | null;
  deltaFlags: DeltaFlag[];
  surveyClosesAt: string | null;
  fieldConfig?: SurveyFieldConfig | null;
}

export default function BenchmarkingSurveyForm({
  benchmarkingId,
  fiscalYear,
  organizationName,
  organizationProvince,
  currentData,
  priorYearData,
  deltaFlags: initialDeltaFlags,
  surveyClosesAt,
  fieldConfig,
}: BenchmarkingSurveyFormProps) {
  const config = useMemo(
    () => fieldConfig ?? DEFAULT_FIELD_CONFIG,
    [fieldConfig]
  );
  const sections = useMemo(
    () => [...config.sections].sort((a, b) => a.order - b.order),
    [config]
  );

  const [activeSection, setActiveSection] = useState(0); // index into sections array
  const [formData, setFormData] = useState<Record<string, unknown>>(
    currentData as unknown as Record<string, unknown>
  );
  const [deltaFlags, setDeltaFlags] = useState<DeltaFlag[]>(initialDeltaFlags);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(
    currentData.updated_at ? new Date(currentData.updated_at) : null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isSubmitted = formData.status === "submitted";
  const isReadOnly = isSubmitted;

  // Auto-save a single field with debounce
  const handleFieldChange = useCallback(
    (field: string, value: string | number | boolean | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSaveError(null);

      if (isReadOnly) return;

      // Debounce the save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      setSaveStatus("saving");
      saveTimeoutRef.current = setTimeout(async () => {
        const result = await saveBenchmarkingField(benchmarkingId, field, value);
        if (result.success) {
          setSaveStatus("saved");
          setLastSaved(new Date());

          // If server returned a corrected value, update local state
          if (result.correctedValue !== undefined) {
            setFormData((prev) => ({ ...prev, [field]: result.correctedValue }));
          }

          // Reset to idle after 3 seconds
          setTimeout(() => setSaveStatus("idle"), 3000);
        } else {
          setSaveStatus("error");
          setSaveError(result.error || "Save failed");
          console.error("Save failed:", result.error);
          // Auto-clear error after 8 seconds
          setTimeout(() => setSaveError(null), 8000);
        }
      }, 800);
    },
    [benchmarkingId, isReadOnly]
  );

  // Handle delta flag
  const handleDeltaFlag = useCallback(
    async (
      fieldName: string,
      previousValue: number | null,
      currentValue: number | null,
      action: "fixed" | "explained",
      explanation?: string
    ) => {
      const result = await saveDeltaFlag(
        benchmarkingId,
        fieldName,
        previousValue,
        currentValue,
        action,
        explanation
      );

      if (result.success) {
        if (action === "fixed") {
          setDeltaFlags((prev) => prev.filter((f) => f.field_name !== fieldName));
        } else {
          setDeltaFlags((prev) => {
            const existing = prev.findIndex((f) => f.field_name === fieldName);
            const newFlag = {
              id: "",
              benchmarking_id: benchmarkingId,
              field_name: fieldName,
              previous_value: previousValue,
              current_value: currentValue,
              pct_change: previousValue ? ((currentValue ?? 0) - previousValue) / previousValue * 100 : null,
              abs_change: (currentValue ?? 0) - (previousValue ?? 0),
              respondent_action: action,
              respondent_explanation: explanation ?? null,
              committee_status: "pending",
              committee_notes: null,
              reviewed_by: null,
              reviewed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as DeltaFlag;

            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = newFlag;
              return updated;
            }
            return [...prev, newFlag];
          });
        }
      }
    },
    [benchmarkingId]
  );

  // Submit survey
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await submitBenchmarkingSurvey(benchmarkingId);
    if (result.success) {
      setFormData((prev) => ({ ...prev, status: "submitted" }));
    } else {
      setSubmitError(result.error || "Failed to submit survey");
    }
    setIsSubmitting(false);
  };

  // Amend survey
  const handleAmend = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await amendBenchmarkingSurvey(benchmarkingId);
    if (result.success) {
      setFormData((prev) => ({ ...prev, status: "draft" }));
    } else {
      setSubmitError(result.error || "Failed to amend survey");
    }
    setIsSubmitting(false);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const priorData = priorYearData as unknown as Record<string, unknown> | null;

  const sectionProps = {
    formData,
    priorYearData: priorData,
    onFieldChange: handleFieldChange,
    onDeltaFlag: handleDeltaFlag,
    deltaFlags,
    isReadOnly,
    organizationName,
    organizationProvince,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              FY{fiscalYear} Benchmarking Survey
            </h1>
            <p className="text-gray-600 mt-1">{organizationName}</p>
          </div>
          <SaveIndicator
            status={saveStatus}
            lastSaved={lastSaved}
            isSubmitted={isSubmitted}
          />
        </div>

        {surveyClosesAt && (
          <p className="text-sm text-gray-500 mt-2">
            Survey closes{" "}
            {parseUTC(surveyClosesAt).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}

        {isSubmitted && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-green-800 font-medium">
                  Survey submitted successfully
                </span>
              </div>
              <button
                onClick={handleAmend}
                disabled={isSubmitting}
                className="text-sm text-green-700 hover:text-green-900 underline"
              >
                {isSubmitting ? "..." : "Amend Submission"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex overflow-x-auto -mb-px" aria-label="Survey sections">
          {sections.map((section, idx) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(idx)}
              className={`whitespace-nowrap px-4 py-3 border-b-2 text-sm font-medium transition-colors ${
                activeSection === idx
                  ? "border-[#EE2A2E] text-[#EE2A2E]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {section.order}. {section.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Error display */}
      {submitError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {submitError}
        </div>
      )}

      {/* Inline save validation error */}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {saveError}
        </div>
      )}

      {/* Active Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {sections[activeSection] && (
          <DynamicSurveySection
            sectionConfig={sections[activeSection]}
            {...sectionProps}
          />
        )}
      </div>

      {/* Navigation + Submit */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => setActiveSection(Math.max(0, activeSection - 1))}
          disabled={activeSection === 0}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <div className="flex items-center gap-3">
          {activeSection < sections.length - 1 ? (
            <button
              onClick={() => setActiveSection(Math.min(sections.length - 1, activeSection + 1))}
              className="px-6 py-2 text-sm font-medium text-white bg-[#EE2A2E] rounded-lg hover:bg-[#D92327]"
            >
              Next Section
            </button>
          ) : !isSubmitted ? (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-8 py-2.5 text-sm font-medium text-white bg-[#EE2A2E] rounded-lg hover:bg-[#D92327] disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit Survey"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Save status indicator
function SaveIndicator({
  status,
  lastSaved,
  isSubmitted,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSaved: Date | null;
  isSubmitted: boolean;
}) {
  if (isSubmitted) return null;

  return (
    <div className="text-sm text-gray-500">
      {status === "saving" && (
        <span className="flex items-center">
          <span className="w-2 h-2 bg-amber-400 rounded-full mr-2 animate-pulse" />
          Saving...
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center text-green-600">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Saved
        </span>
      )}
      {status === "error" && (
        <span className="text-red-600">Save failed — will retry</span>
      )}
      {status === "idle" && lastSaved && (
        <span>
          Last saved {lastSaved.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
