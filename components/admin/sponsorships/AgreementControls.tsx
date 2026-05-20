"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionAgreementStatus } from "@/lib/actions/sponsorship";
import { AGREEMENT_STATUS_TRANSITIONS } from "@/lib/sponsorship/types";
import type { SponsorAgreementStatus } from "@/lib/sponsorship/types";
import SponsorStatusBadge from "./SponsorStatusBadge";

const STATUS_LABELS: Record<SponsorAgreementStatus, string> = {
  draft:     "Draft",
  active:    "Active",
  expired:   "Expired",
  cancelled: "Cancelled",
};

const ACTIVATION_NOTE =
  "Activating this agreement will auto-provision placements and trigger Circle space provisioning for eligible benefits.";

interface AgreementControlsProps {
  agreementId: string;
  currentStatus: SponsorAgreementStatus;
}

export default function AgreementControls({ agreementId, currentStatus }: AgreementControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<SponsorAgreementStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allowed = AGREEMENT_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (allowed.length === 0) return null;

  function handleTransition(to: SponsorAgreementStatus) {
    if (confirm !== to) { setConfirm(to); return; }
    setConfirm(null);
    setError(null);
    startTransition(async () => {
      const result = await transitionAgreementStatus(agreementId, to);
      if (result.success) {
        setSuccess(`Agreement moved to ${STATUS_LABELS[to]}.`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const primaryActions = allowed.filter((s) => s !== "cancelled");
  const dangerActions  = allowed.filter((s) => s === "cancelled");

  return (
    <div className="space-y-3">
      {/* Primary transitions */}
      {primaryActions.length > 0 && (
        <div className="p-4 rounded-xl border border-gray-200 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</p>

          {confirm && confirm !== "cancelled" && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              {confirm === "active" && <p className="mb-2">{ACTIVATION_NOTE}</p>}
              <p>Move agreement to <strong>{STATUS_LABELS[confirm]}</strong>?</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {primaryActions.map((to) => {
              const isConfirming = confirm === to;
              return isConfirming ? (
                <div key={to} className="flex gap-2">
                  <button
                    onClick={() => handleTransition(to)}
                    disabled={isPending}
                    className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {isPending ? "Updating…" : `Confirm → ${STATUS_LABELS[to]}`}
                  </button>
                  <button
                    onClick={() => setConfirm(null)}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  key={to}
                  onClick={() => handleTransition(to)}
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Move to {STATUS_LABELS[to]}
                </button>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
        </div>
      )}

      {/* Danger zone (cancel) */}
      {dangerActions.length > 0 && (
        <div className="p-4 rounded-xl border border-red-100 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Danger Zone</p>
          {confirm === "cancelled" ? (
            <div className="space-y-2">
              <p className="text-sm text-red-700">
                Cancelling will deactivate all placements immediately.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTransition("cancelled")}
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Cancelling…" : "Confirm Cancel Agreement"}
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirm("cancelled")}
              disabled={isPending}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Cancel Agreement
            </button>
          )}
        </div>
      )}
    </div>
  );
}
