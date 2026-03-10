"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  initiateAdminTransfer,
  acceptAdminTransfer,
  cancelAdminTransfer,
} from "@/lib/actions/admin-transfer";
import type { TransferCandidate } from "@/app/org/[slug]/admin/transfer/page";

interface PendingTransferInfo {
  id: string;
  fromUserId: string;
  fromUserName: string | null;
  toUserId: string | null;
  toUserName: string | null;
  timeoutAt: string;
  reason: string | null;
}

interface AdminTransferFlowProps {
  orgId: string;
  orgSlug: string;
  currentUserId: string;
  candidates: TransferCandidate[];
  pendingTransfer: PendingTransferInfo | null;
}

type Step = "select" | "confirm" | "pending";

export function AdminTransferFlow({
  orgId,
  orgSlug,
  currentUserId,
  candidates,
  pendingTransfer,
}: AdminTransferFlowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(
    pendingTransfer ? "pending" : "select"
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Countdown for pending transfer
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!pendingTransfer) return;

    function updateCountdown() {
      const target = new Date(pendingTransfer!.timeoutAt).getTime();
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("Auto-approving...");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours}h ${minutes}m remaining`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 60_000);
    return () => clearInterval(interval);
  }, [pendingTransfer]);

  const selectedCandidate = candidates.find(
    (c) => c.userId === selectedUserId
  );

  async function handleInitiate() {
    setError(null);
    setIsSubmitting(true);

    const result = await initiateAdminTransfer(
      orgId,
      selectedUserId,
      reason || undefined
    );

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Failed to initiate transfer");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function handleAccept() {
    if (!pendingTransfer) return;
    setError(null);
    setIsSubmitting(true);

    const result = await acceptAdminTransfer(pendingTransfer.id);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Failed to accept transfer");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function handleCancel() {
    if (!pendingTransfer) return;
    setError(null);
    setIsSubmitting(true);

    const result = await cancelAdminTransfer(pendingTransfer.id);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Failed to cancel transfer");
      return;
    }

    startTransition(() => router.refresh());
  }

  // ─── Pending State ────────────────────────────────────────────
  if (step === "pending" && pendingTransfer) {
    const isInitiator = pendingTransfer.fromUserId === currentUserId;
    const isSuccessor = pendingTransfer.toUserId === currentUserId;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
          <h2 className="text-lg font-semibold text-gray-900">
            Transfer In Progress
          </h2>
        </div>

        <div className="space-y-3 text-sm text-gray-600">
          <p>
            <span className="font-medium">From:</span>{" "}
            {pendingTransfer.fromUserName ?? "Unknown"}
            {isInitiator && " (you)"}
          </p>
          <p>
            <span className="font-medium">To:</span>{" "}
            {pendingTransfer.toUserId
              ? pendingTransfer.toUserName ?? "Unknown"
              : "No successor (fallback to super admin)"}
            {isSuccessor && " (you)"}
          </p>
          {pendingTransfer.reason && (
            <p>
              <span className="font-medium">Reason:</span>{" "}
              {pendingTransfer.reason}
            </p>
          )}
          <p>
            <span className="font-medium">Auto-approval:</span> {timeLeft}
          </p>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          {/* Successor can accept */}
          {isSuccessor && (
            <button
              onClick={handleAccept}
              disabled={isSubmitting || isPending}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Accepting..." : "Accept Transfer"}
            </button>
          )}

          {/* Initiator can cancel */}
          {isInitiator && (
            <button
              onClick={handleCancel}
              disabled={isSubmitting || isPending}
              className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Canceling..." : "Cancel Transfer"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Confirm Step ─────────────────────────────────────────────
  if (step === "confirm") {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Confirm Admin Transfer
        </h2>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-800">
            {selectedCandidate ? (
              <>
                You are transferring admin rights to{" "}
                <strong>
                  {selectedCandidate.displayName ??
                    selectedCandidate.email ??
                    "the selected user"}
                </strong>
                . They can accept immediately, or the transfer will
                auto-complete after the configured timeout period.
              </>
            ) : (
              <>
                You are initiating a transfer with{" "}
                <strong>no successor</strong>. After the timeout period, a
                super admin will be assigned as temporary org admin.
              </>
            )}
          </p>
        </div>

        {/* Optional reason */}
        <div className="mb-4">
          <label
            htmlFor="transfer-reason"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Reason (optional)
          </label>
          <input
            id="transfer-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Leaving the organization"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isSubmitting}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={() => {
              setStep("select");
              setError(null);
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            disabled={isSubmitting}
          >
            Back
          </button>
          <button
            onClick={handleInitiate}
            disabled={isSubmitting || isPending}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "Initiating..." : "Confirm Transfer"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Select Step ──────────────────────────────────────────────
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        Transfer Admin Rights
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Select a successor to receive admin rights for this organization.
        The transfer can be accepted immediately by the successor, or will
        auto-complete after the configured timeout.
      </p>

      {candidates.length > 0 ? (
        <div className="space-y-2 mb-6">
          {candidates.map((candidate) => (
            <label
              key={candidate.userId}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedUserId === candidate.userId
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="successor"
                value={candidate.userId}
                checked={selectedUserId === candidate.userId}
                onChange={() => setSelectedUserId(candidate.userId)}
                className="text-blue-600"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {candidate.displayName ?? "Unnamed user"}
                </div>
                {candidate.email && (
                  <div className="text-xs text-gray-500">
                    {candidate.email}
                  </div>
                )}
              </div>
            </label>
          ))}

          {/* No successor option */}
          <label
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedUserId === null &&
              candidates.length > 0
                ? "border-amber-500 bg-amber-50"
                : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="successor"
              value=""
              checked={selectedUserId === null}
              onChange={() => setSelectedUserId(null)}
              className="text-amber-600"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">
                No successor available
              </div>
              <div className="text-xs text-gray-500">
                A super admin will be assigned as temporary admin
              </div>
            </div>
          </label>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
          No other active members in this organization. A super admin will
          be assigned as temporary admin after the timeout.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={() => setStep("confirm")}
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
