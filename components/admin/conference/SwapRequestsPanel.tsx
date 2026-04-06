"use client";

import { useMemo, useState } from "react";
import {
  adminGrantSwapCapIncrease,
  decideSwapCapIncreaseRequest,
  listSwapCapIncreaseRequests,
  listSwapRequests,
} from "@/lib/actions/conference-swaps";
import type { Database } from "@/lib/database.types";
import type { SwapRequestSummary } from "@/lib/scheduler/types";
import { Timestamp } from "@/components/ui/LocalDate";

type CapIncreaseRow = Database["public"]["Tables"]["swap_cap_increase_requests"]["Row"];

function badgeClass(status: string): string {
  if (status === "approved_committed") return "bg-green-100 text-green-700";
  if (status === "denied_invalid" || status === "denied_cap_reached") return "bg-red-100 text-red-700";
  if (status === "requested" || status === "options_generated") return "bg-blue-100 text-[#D92327]";
  return "bg-gray-100 text-gray-700";
}

export default function SwapRequestsPanel({
  conferenceId,
  initialSwapRequests,
  initialCapIncreaseRequests,
}: {
  conferenceId: string;
  initialSwapRequests: SwapRequestSummary[];
  initialCapIncreaseRequests: CapIncreaseRow[];
}) {
  const [swapRequests, setSwapRequests] = useState(initialSwapRequests);
  const [capRequests, setCapRequests] = useState(initialCapIncreaseRequests);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const visibleSwapRequests = useMemo(() => {
    if (statusFilter === "all") return swapRequests;
    return swapRequests.filter((row) => row.status === statusFilter);
  }, [statusFilter, swapRequests]);

  async function refresh() {
    setIsLoading(true);
    setError(null);

    const [swapResult, capResult] = await Promise.all([
      listSwapRequests(conferenceId),
      listSwapCapIncreaseRequests(conferenceId),
    ]);

    if (!swapResult.success) {
      setError(swapResult.error);
      setIsLoading(false);
      return;
    }
    if (!capResult.success) {
      setError(capResult.error);
      setIsLoading(false);
      return;
    }

    setSwapRequests(swapResult.data);
    setCapRequests(capResult.data);
    setIsLoading(false);
  }

  async function decideCapRequest(requestId: string, decision: "approved" | "denied") {
    setError(null);
    const adminNote =
      decision === "approved"
        ? "Approved by admin dashboard."
        : "Denied by admin dashboard.";

    const result = await decideSwapCapIncreaseRequest(requestId, decision, adminNote);
    if (!result.success) {
      setError(result.error);
      return;
    }

    await refresh();
  }

  async function grantDirectOverride(delegateRegistrationId: string) {
    setError(null);
    const extraInput = window.prompt("Grant how many additional swaps?", "1");
    if (!extraInput) return;
    const extra = Number(extraInput);
    if (!Number.isInteger(extra) || extra <= 0) {
      setError("Override amount must be a positive whole number.");
      return;
    }

    const reason = window.prompt("Admin override reason:", "Manual cap override");
    if (!reason || !reason.trim()) return;

    const result = await adminGrantSwapCapIncrease(
      conferenceId,
      delegateRegistrationId,
      extra,
      reason.trim()
    );
    if (!result.success) {
      setError(result.error);
      return;
    }

    await refresh();
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Swap Requests</h3>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="all">All statuses</option>
            <option value="requested">requested</option>
            <option value="options_generated">options_generated</option>
            <option value="approved_committed">approved_committed</option>
            <option value="denied_invalid">denied_invalid</option>
            <option value="denied_cap_reached">denied_cap_reached</option>
            <option value="canceled">canceled</option>
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Delegate Reg</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Swap #</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {visibleSwapRequests.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-400">
                  No swap requests found.
                </td>
              </tr>
            ) : (
              visibleSwapRequests.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    <Timestamp iso={row.createdAt} format="compact" />
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">
                    {row.delegateRegistrationId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{row.swapNumber}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`inline-flex rounded-full px-2 py-0.5 ${badgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{row.reason ?? "-"}</td>
                  <td className="px-4 py-3 text-right">
                    {row.status === "denied_cap_reached" ? (
                      <button
                        type="button"
                        onClick={() => void grantDirectOverride(row.delegateRegistrationId)}
                        className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:border-amber-400"
                      >
                        Grant Override
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Cap Increase Requests</h3>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Delegate Reg</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Requested +</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {capRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-400">
                    No cap increase requests found.
                  </td>
                </tr>
              ) : (
                capRequests.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <Timestamp iso={row.created_at} format="compact" />
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">
                      {row.delegate_registration_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{row.requested_extra_swaps}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.reason ?? "-"}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`inline-flex rounded-full px-2 py-0.5 ${badgeClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "requested" ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void decideCapRequest(row.id, "approved")}
                            className="rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:border-green-400"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void decideCapRequest(row.id, "denied")}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:border-red-400"
                          >
                            Deny
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">
                          {row.decided_at ? <Timestamp iso={row.decided_at} format="compact" /> : "resolved"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
