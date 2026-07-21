"use client";

import { useState } from "react";
import { parseUTC } from "@/lib/utils";
import { renewMembershipNow } from "@/lib/actions/renewal";

/**
 * Self-serve "Renew Now" for a Member/Partner org admin — generates (or
 * reuses) the org's renewal invoice on demand instead of only ever getting
 * one automatically at the 30-day reminder mark, or as a side effect of an
 * unrelated conference purchase. Only shown to privileged viewers (org_admin
 * for this org, or a CSC admin) since membership status/billing is not
 * public information.
 */
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

  const canRenew = membershipStatus === "active" || membershipStatus === "reactivated";
  if (!membershipStatus) return null;

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
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">Membership: {membershipStatus}</span>
        {membershipExpiresAt && (
          <span className="ml-2 text-gray-500">
            renews {parseUTC(membershipExpiresAt).toLocaleDateString("en-CA")}
          </span>
        )}
      </div>
      {canRenew && (
        <button
          onClick={handleRenew}
          disabled={loading}
          className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0f2c50] disabled:opacity-50"
        >
          {loading ? "Preparing invoice…" : "Renew Now"}
        </button>
      )}
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
