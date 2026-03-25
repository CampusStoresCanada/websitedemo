"use client";

import { useState } from "react";
import { parseUTC } from "@/lib/utils";
import { optOutOfRenewal } from "@/lib/actions/renewal";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface RenewalStatusCardProps {
  orgId: string;
  orgName: string;
  membershipStatus: string | null;
  membershipExpiresAt: string | null;
  gracePeriodStartedAt: string | null;
  graceDays: number;
  /** The most recent renewal invoice, if any */
  renewalInvoice: {
    id: string;
    status: string;
    totalCents: number;
    dueDate: string | null;
    stripeInvoiceUrl: string | null;
  } | null;
  /** Whether the current user can manage this org (org_admin or global admin) */
  canManage: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Status display config
// ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; borderColor: string }
> = {
  active: {
    label: "Active",
    color: "text-green-800",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  reactivated: {
    label: "Reactivated",
    color: "text-green-800",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  grace: {
    label: "Grace Period",
    color: "text-yellow-800",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
  },
  locked: {
    label: "Locked",
    color: "text-red-800",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
  },
  canceled: {
    label: "Canceled",
    color: "text-gray-700",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
  },
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function RenewalStatusCard({
  orgId,
  orgName,
  membershipStatus,
  membershipExpiresAt,
  gracePeriodStartedAt,
  graceDays,
  renewalInvoice,
  canManage,
}: RenewalStatusCardProps) {
  const router = useRouter();
  const [showOptOut, setShowOptOut] = useState(false);
  const [optOutReason, setOptOutReason] = useState("");
  const [optOutLoading, setOptOutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const status = membershipStatus ?? "unknown";
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    color: "text-gray-700",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
  };

  // Calculate days until expiry
  const daysUntilExpiry = membershipExpiresAt
    ? Math.ceil(
        (new Date(membershipExpiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Calculate days remaining in grace
  const graceDaysRemaining =
    status === "grace" && gracePeriodStartedAt
      ? Math.max(
          0,
          Math.ceil(
            graceDays -
              (Date.now() - new Date(gracePeriodStartedAt).getTime()) /
                (1000 * 60 * 60 * 24)
          )
        )
      : null;

  async function handleOptOut() {
    if (!optOutReason.trim()) {
      setError("Please provide a reason for opting out.");
      return;
    }

    setError(null);
    setOptOutLoading(true);

    const result = await optOutOfRenewal(orgId, optOutReason.trim());

    setOptOutLoading(false);

    if (!result.success) {
      setError(result.error ?? "Failed to process opt-out");
      return;
    }

    setSuccess("Opt-out processed successfully. Your membership will not renew.");
    setShowOptOut(false);
    setOptOutReason("");
    router.refresh();
  }

  const canOptOut =
    canManage && ["active", "grace", "reactivated"].includes(status);

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-5`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          Renewal Status
        </h3>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color} ${config.bgColor} border ${config.borderColor}`}
        >
          {config.label}
        </span>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Renewal date */}
        {membershipExpiresAt && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Next Renewal</span>
            <span className="text-sm font-medium text-gray-900">
              {parseUTC(membershipExpiresAt).toLocaleDateString("en-CA")}
              {daysUntilExpiry !== null && (
                <span className="ml-1.5 text-xs text-gray-500">
                  ({daysUntilExpiry > 0 ? `${daysUntilExpiry}d away` : "overdue"})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Grace period countdown */}
        {graceDaysRemaining !== null && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-yellow-700 font-medium">
              Grace Period Remaining
            </span>
            <span className="text-sm font-bold text-yellow-800">
              {graceDaysRemaining} day{graceDaysRemaining !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Invoice status */}
        {renewalInvoice && (
          <div className="pt-2 border-t border-gray-200/60 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Renewal Invoice</span>
              <span className="text-sm text-gray-900">
                ${(renewalInvoice.totalCents / 100).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">
                Status: {renewalInvoice.status}
                {renewalInvoice.dueDate && (
                  <> &middot; Due{" "}
                    {parseUTC(renewalInvoice.dueDate).toLocaleDateString(
                      "en-CA"
                    )}
                  </>
                )}
              </span>
              {renewalInvoice.stripeInvoiceUrl &&
                renewalInvoice.status !== "paid" && (
                  <a
                    href={renewalInvoice.stripeInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-[#EE2A2E] hover:text-[#D92327] underline"
                  >
                    Pay Now
                  </a>
                )}
            </div>
          </div>
        )}
      </div>

      {/* Error / Success */}
      {error && (
        <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 p-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Opt-Out */}
      {canOptOut && !success && (
        <div className="mt-4 pt-3 border-t border-gray-200/60">
          {showOptOut ? (
            <div className="space-y-2">
              <textarea
                rows={2}
                value={optOutReason}
                onChange={(e) => setOptOutReason(e.target.value)}
                placeholder="Reason for opting out of renewal (required)..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOptOut}
                  disabled={optOutLoading}
                  className="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {optOutLoading ? "Processing..." : "Confirm Opt-Out"}
                </button>
                <button
                  onClick={() => {
                    setShowOptOut(false);
                    setOptOutReason("");
                    setError(null);
                  }}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowOptOut(true)}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
            >
              Opt out of renewal
            </button>
          )}
        </div>
      )}

      {/* Locked state message */}
      {status === "locked" && (
        <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          Your membership is locked due to non-payment. Please contact an
          administrator to discuss reactivation.
        </div>
      )}
    </div>
  );
}
