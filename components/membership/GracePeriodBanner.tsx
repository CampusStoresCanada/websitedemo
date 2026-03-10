"use client";

import { graceDaysRemaining } from "@/lib/membership/state-machine";
import type { OrgMembershipStatus } from "@/lib/membership/types";

interface GracePeriodBannerProps {
  status: OrgMembershipStatus | null;
  gracePeriodStartedAt: string | null;
  graceDays: number;
  /** URL to the payment/renewal page */
  renewalHref?: string;
}

export default function GracePeriodBanner({
  status,
  gracePeriodStartedAt,
  graceDays,
  renewalHref = "/account/renew",
}: GracePeriodBannerProps) {
  const remaining = graceDaysRemaining(
    status,
    gracePeriodStartedAt ? new Date(gracePeriodStartedAt) : null,
    graceDays
  );

  if (remaining === null) return null;

  const isUrgent = remaining <= 7;

  return (
    <div
      className={`w-full px-4 py-3 text-center text-sm font-medium ${
        isUrgent
          ? "bg-red-50 text-red-800 border-b border-red-200"
          : "bg-yellow-50 text-yellow-800 border-b border-yellow-200"
      }`}
    >
      <span>
        {remaining === 0
          ? "Your grace period expires today."
          : `You have ${remaining} day${remaining !== 1 ? "s" : ""} remaining in your grace period.`}
      </span>{" "}
      <a
        href={renewalHref}
        className={`underline font-semibold ${
          isUrgent ? "text-red-900" : "text-yellow-900"
        }`}
      >
        Pay now to maintain access
      </a>
    </div>
  );
}
