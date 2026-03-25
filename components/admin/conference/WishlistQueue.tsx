"use client";

import { useState } from "react";
import { parseUTC } from "@/lib/utils";
import {
  listWishlistIntentsForConference,
  runWishlistBilling,
  setWishlistBoardDecision,
  updateWishlistIntentStatus,
} from "@/lib/actions/conference-commerce";
import type { Database } from "@/lib/database.types";

type WishlistRow = Database["public"]["Tables"]["wishlist_intents"]["Row"] & {
  organization_name: string | null;
  product_name: string | null;
};

export default function WishlistQueue({
  conferenceId,
  initialRows,
}: {
  conferenceId: string;
  initialRows: WishlistRow[];
}) {
  const [rows, setRows] = useState<WishlistRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const reload = async (status?: string) => {
    const result = await listWishlistIntentsForConference({
      conferenceId,
      status: status && status !== "all" ? status : undefined,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setRows(result.data);
    setError(null);
  };

  const handleDecision = async (intentId: string, decision: "approve" | "decline") => {
    setIsLoading(true);
    setError(null);
    const result = await setWishlistBoardDecision({ intentId, decision });
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    await reload(statusFilter);
    setIsLoading(false);
  };

  const handleRunBilling = async () => {
    setIsLoading(true);
    setError(null);
    const result = await runWishlistBilling(conferenceId);
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    await reload(statusFilter);
    setIsLoading(false);
  };

  const handleTransition = async (intentId: string, nextStatus: string) => {
    setIsLoading(true);
    setError(null);
    const result = await updateWishlistIntentStatus({
      intentId,
      nextStatus: nextStatus as Parameters<typeof updateWishlistIntentStatus>[0]["nextStatus"],
    });
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    await reload(statusFilter);
    setIsLoading(false);
  };

  return (
    <section className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Filter</label>
          <select
            value={statusFilter}
            onChange={async (event) => {
              const value = event.target.value;
              setStatusFilter(value);
              await reload(value);
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="all">All</option>
            <option value="wishlisted">wishlisted</option>
            <option value="board_pending">board_pending</option>
            <option value="board_approved">board_approved</option>
            <option value="board_declined">board_declined</option>
            <option value="billing_pending">billing_pending</option>
            <option value="billing_paid">billing_paid</option>
            <option value="billing_failed_retryable">billing_failed_retryable</option>
            <option value="billing_failed_final">billing_failed_final</option>
            <option value="reservation_expired">reservation_expired</option>
            <option value="registered">registered</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => reload(statusFilter)}
            disabled={isLoading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleRunBilling}
            disabled={isLoading}
            className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
          >
            Run Billing
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Wishlisted At</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Organization</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Product</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Qty</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Queue</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map((row) => {
              const canBoardDecide =
                row.status === "wishlisted" || row.status === "board_pending";
              const transitionOptions =
                row.status === "board_approved"
                  ? ["billing_pending", "registered", "billing_failed_retryable"]
                  : row.status === "billing_failed_retryable"
                    ? ["billing_pending", "billing_failed_final", "reservation_expired"]
                    : row.status === "billing_pending"
                      ? ["billing_paid", "billing_failed_retryable", "billing_failed_final"]
                      : row.status === "billing_paid"
                        ? ["registered"]
                        : row.status === "billing_failed_final"
                          ? ["reservation_expired"]
                          : [];
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <Timestamp iso={row.wishlisted_at} format="compact" />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.organization_name ?? "Unknown org"}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.product_name ?? "Unknown product"}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.quantity}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.queue_position ?? "n/a"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!canBoardDecide || isLoading}
                        onClick={() => handleDecision(row.id, "approve")}
                        className="rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:border-green-400 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!canBoardDecide || isLoading}
                        onClick={() => handleDecision(row.id, "decline")}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:border-red-400 disabled:opacity-50"
                      >
                        Decline
                      </button>
                      {transitionOptions.length > 0 ? (
                        <select
                          defaultValue=""
                          disabled={isLoading}
                          onChange={async (event) => {
                            const value = event.target.value;
                            if (!value) return;
                            await handleTransition(row.id, value);
                            event.target.value = "";
                          }}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700"
                        >
                          <option value="">Transition...</option>
                          {transitionOptions.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">
                      board:{row.board_decided_at ? parseUTC(row.board_decided_at).toLocaleDateString() : "-"} | billing:{row.billing_attempted_at ? parseUTC(row.billing_attempted_at).toLocaleDateString() : "-"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
