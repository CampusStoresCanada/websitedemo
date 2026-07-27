"use client";

import { useState } from "react";
import { parseUTC } from "@/lib/utils";
import { renewMembershipNow } from "@/lib/actions/renewal";

/**
 * Self-serve "Renew Now" for CSC staff — generates (or reuses) an org's
 * renewal invoice on demand instead of only ever getting one automatically
 * at the reminder-window mark, or as a side effect of an unrelated
 * conference purchase. Status-color scheme matches RenewalStatusCard
 * (components/renewal/RenewalStatusCard.tsx) — same underlying concept,
 * kept visually consistent even though that card isn't mounted anywhere yet.
 */
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  active: { label: "Active", color: "text-green-800", bgColor: "bg-green-50", borderColor: "border-green-200" },
  reactivated: { label: "Reactivated", color: "text-green-800", bgColor: "bg-green-50", borderColor: "border-green-200" },
  grace: { label: "Grace Period", color: "text-yellow-800", bgColor: "bg-yellow-50", borderColor: "border-yellow-200" },
  locked: { label: "Locked", color: "text-red-800", bgColor: "bg-red-50", borderColor: "border-red-200" },
  canceled: { label: "Canceled", color: "text-gray-700", bgColor: "bg-gray-50", borderColor: "border-gray-200" },
};

export default function RenewMembershipCard({
  organizationId,
  membershipStatus,
  membershipExpiresAt,
}: {
  organizationId: string;
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!membershipStatus) return null;
  const config = STATUS_CONFIG[membershipStatus] ?? {
    label: membershipStatus,
    color: "text-gray-700",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
  };
  // "canceled" is a deliberate opt-out (voids/refunds invoices) with no
  // reversal path today — no self-serve button, just a pointer to staff.
  const canRenew = ["active", "reactivated", "grace", "locked"].includes(membershipStatus);
  const isLapsed = membershipStatus === "grace" || membershipStatus === "locked";

  async function handleRenew() {
    setLoading(true);
    setError(null);
    const result = await renewMembershipNow(organizationId);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to start renewal.");
      return;
    }
    if (result.invoiceUrl) {
      window.open(result.invoiceUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className={`mb-8 rounded-xl border ${config.borderColor} ${config.bgColor} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Renewal Status</h3>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color} ${config.bgColor} border ${config.borderColor}`}
          >
            {config.label}
          </span>
        </div>
        {canRenew && (
          <button
            onClick={handleRenew}
            disabled={loading}
            className="px-4 py-1.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? "Preparing invoice…" : isLapsed ? "Reactivate Membership" : "Renew Now"}
          </button>
        )}
      </div>
      {membershipExpiresAt && (
        <p className="mt-2 text-sm text-gray-600">
          Renews {parseUTC(membershipExpiresAt).toLocaleDateString("en-CA")}
        </p>
      )}
      {membershipStatus === "canceled" && (
        <p className="mt-2 text-sm text-gray-600">
          This organization opted out of renewal. Contact CSC staff to re-apply.
        </p>
      )}
      {error && <p className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</p>}
    </div>
  );
}
