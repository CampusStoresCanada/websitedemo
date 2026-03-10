"use client";

import type { ReactNode } from "react";
import type { OrgMembershipStatus } from "@/lib/membership/types";
import { isOrgAccessActive, isOrgInGrace } from "@/lib/membership/state-machine";
import GracePeriodBanner from "./GracePeriodBanner";

interface AccessGateProps {
  status: OrgMembershipStatus | null;
  gracePeriodStartedAt?: string | null;
  graceDays?: number;
  renewalHref?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Wraps protected content and gates access based on org membership status.
 *
 * - active/reactivated → render children
 * - grace → render children + GracePeriodBanner
 * - locked/canceled/applied/approved/null → render fallback
 */
export default function AccessGate({
  status,
  gracePeriodStartedAt = null,
  graceDays = 30,
  renewalHref,
  fallback,
  children,
}: AccessGateProps) {
  if (!isOrgAccessActive(status)) {
    if (fallback) return <>{fallback}</>;

    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 116.636 6.636 9 9 0 0119.364 16.636z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Access Restricted
        </h3>
        <p className="text-sm text-gray-600 max-w-md">
          {status === "locked"
            ? "Your organization's membership has been locked due to non-payment. Contact us to reactivate."
            : status === "canceled"
            ? "Your organization's membership has been canceled. Please contact us to re-apply."
            : status === "applied"
            ? "Your application is being reviewed. You'll have access once approved."
            : status === "approved"
            ? "Your organization has been approved. Complete payment to activate your membership."
            : "You need an active membership to access this content."}
        </p>
      </div>
    );
  }

  return (
    <>
      {isOrgInGrace(status) && (
        <GracePeriodBanner
          status={status}
          gracePeriodStartedAt={gracePeriodStartedAt ?? null}
          graceDays={graceDays}
          renewalHref={renewalHref}
        />
      )}
      {children}
    </>
  );
}
