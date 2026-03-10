"use client";

import type { WizardStep } from "@/lib/types/conference";

interface WizardShellProps {
  currentStep: number;
  steps: WizardStep[];
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  isLoading?: boolean;
  error?: string | null;
}

export default function WizardShell({
  currentStep,
  steps,
  children,
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  isLoading = false,
  error,
}: WizardShellProps) {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 mb-8 flex-wrap">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                i === currentStep
                  ? "bg-[#D60001] text-white"
                  : i < currentStep
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < currentStep ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m4.5 12.75 6 6 9-13.5"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-4 h-0.5 ${
                  i < currentStep ? "bg-green-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Current step label */}
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Step {currentStep + 1} of {steps.length}
      </h2>
      <p className="text-sm text-gray-500 mb-6">{steps[currentStep]?.label}</p>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="min-h-[200px]">{children}</div>

      {/* Footer navigation */}
      <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
        {onBack && currentStep > 0 ? (
          <button
            type="button"
            onClick={onBack}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || isLoading}
            className="px-6 py-2 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading && (
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
