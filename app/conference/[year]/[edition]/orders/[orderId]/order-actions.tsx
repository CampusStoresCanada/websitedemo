"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  calculateConferenceRefund,
  getConferenceReceiptUrl,
  requestConferenceRefund,
} from "@/lib/actions/conference-commerce";
import { formatCents } from "@/lib/utils";

export default function OrderActions({
  orderId,
  orderStatus,
  canOverrideRefund,
}: {
  orderId: string;
  orderStatus: string;
  canOverrideRefund: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [overrideRefundCents, setOverrideRefundCents] = useState<string>("");

  const canRefund = orderStatus === "paid" || orderStatus === "partially_refunded";

  const handleReceipt = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await getConferenceReceiptUrl(orderId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (!result.data.url) {
        setInfo("Receipt URL is not available yet for this payment.");
        return;
      }
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  };

  const handleRefundQuote = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await calculateConferenceRefund(orderId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      const quote = result.data;
      if (!quote.eligible) {
        setInfo("No refund available under current policy.");
        return;
      }
      setInfo(
        `Refund quote: ${quote.refundPct}% (${formatCents(
          quote.refundAmountCents
        )}), ${quote.daysUntilConference} days until conference.`
      );
    });
  };

  const handleRefund = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const overrideAmount =
        canOverrideRefund && overrideRefundCents.trim().length > 0
          ? Number.parseInt(overrideRefundCents, 10)
          : undefined;
      const effectiveResult = await requestConferenceRefund(orderId, overrideAmount);
      if (!effectiveResult.success) {
        setError(effectiveResult.error);
        return;
      }
      setInfo(
        `Refund submitted: ${formatCents(effectiveResult.data.refundAmountCents)} (${effectiveResult.data.refundPct}%). Total refunded: ${formatCents(effectiveResult.data.totalRefundedCents)}.`
      );
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Actions</h2>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {info ? (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{info}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canOverrideRefund ? (
          <input
            type="number"
            min={1}
            value={overrideRefundCents}
            onChange={(event) => setOverrideRefundCents(event.target.value)}
            placeholder="Override cents"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        ) : null}
        <button
          type="button"
          onClick={handleReceipt}
          disabled={isPending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          View Receipt
        </button>
        <button
          type="button"
          onClick={handleRefundQuote}
          disabled={isPending || !canRefund}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Calculate Refund
        </button>
        <button
          type="button"
          onClick={handleRefund}
          disabled={isPending || !canRefund}
          className="rounded-md bg-[#D60001] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
        >
          Request Refund
        </button>
      </div>
    </div>
  );
}
