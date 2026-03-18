"use client";

import type { ReactNode } from "react";

export type ConsentType = "travel" | "dietary";

interface ConsentGateProps {
  consentType: ConsentType;
  consentText: string;
  isRequired: boolean;
  consentGiven: boolean;
  onConsentChange: (next: boolean) => void;
  children: ReactNode;
}

export default function ConsentGate({
  consentType,
  consentText,
  isRequired,
  consentGiven,
  onConsentChange,
  children,
}: ConsentGateProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => onConsentChange(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-[#EE2A2E]"
          />
          <span className="text-sm text-gray-700">
            {consentText}{" "}
            {isRequired ? (
              <span className="font-medium text-gray-900">
                (Required to enter {consentType} details)
              </span>
            ) : (
              <span className="text-gray-500">(Optional)</span>
            )}
          </span>
        </label>
      </div>

      {!consentGiven && isRequired ? (
        <p className="text-xs text-amber-700">
          Enable consent to continue with {consentType} fields.
        </p>
      ) : null}

      {consentGiven ? <div className="space-y-3">{children}</div> : null}
    </div>
  );
}
