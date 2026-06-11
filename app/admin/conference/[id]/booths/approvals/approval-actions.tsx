"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveBoothRequest, rejectBoothRequest } from "@/lib/actions/conference-booths";

type Props = {
  approvalId: string;
  approver1Id: string | null;
  currentAdminId: string;
};

export default function ApprovalActions({ approvalId, approver1Id, currentAdminId }: Props) {
  const router = useRouter();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const alreadyApproved = approver1Id === currentAdminId;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveBoothRequest(approvalId);
      if (!result.success) {
        setError(result.error ?? "Approval failed.");
        return;
      }
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rejectBoothRequest(approvalId, rejectReason.trim());
      if (!result.success) {
        setError(result.error ?? "Rejection failed.");
        return;
      }
      router.refresh();
    });
  }

  if (showReject) {
    return (
      <div className="flex flex-col gap-2 min-w-52">
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason for rejection…"
          rows={3}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShowReject(false); setError(null); }}
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={isPending}
            className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Rejecting…" : "Confirm Reject"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      {alreadyApproved ? (
        <p className="text-xs text-gray-500">You already approved. Waiting for second admin.</p>
      ) : (
        <button
          type="button"
          onClick={handleApprove}
          disabled={isPending}
          className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? "Approving…" : approver1Id ? "Second Approval" : "Approve"}
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowReject(true)}
        disabled={isPending}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        Reject
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
