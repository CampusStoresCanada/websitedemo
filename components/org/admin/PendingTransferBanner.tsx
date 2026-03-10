"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  acceptAdminTransfer,
  cancelAdminTransfer,
} from "@/lib/actions/admin-transfer";

interface PendingTransferBannerProps {
  requestId: string;
  fromUserId: string;
  toUserId: string | null;
  timeoutAt: string;
  orgSlug: string;
}

export function PendingTransferBanner({
  requestId,
  fromUserId,
  toUserId,
  timeoutAt,
  orgSlug,
}: PendingTransferBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function updateCountdown() {
      const target = new Date(timeoutAt).getTime();
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("Auto-approving...");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours}h ${minutes}m`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 60_000);
    return () => clearInterval(interval);
  }, [timeoutAt]);

  async function handleAccept() {
    setError(null);
    setIsSubmitting(true);
    const result = await acceptAdminTransfer(requestId);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Failed to accept transfer");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function handleCancel() {
    setError(null);
    setIsSubmitting(true);
    const result = await cancelAdminTransfer(requestId);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Failed to cancel transfer");
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Admin transfer in progress
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Auto-approval in {timeLeft}
            </p>
          </div>
        </div>

        <Link
          href={`/org/${orgSlug}/admin/transfer`}
          className="text-xs text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
        >
          View details
        </Link>
      </div>

      {error && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Quick action buttons if user is the successor */}
      {toUserId && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleAccept}
            disabled={isSubmitting || isPending}
            className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "..." : "Accept"}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSubmitting || isPending}
            className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
