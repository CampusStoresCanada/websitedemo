"use client";

import { useState } from "react";
import {
  listBillingRunsForConference,
  listWishlistBillingAttemptsForConference,
} from "@/lib/actions/conference-commerce";
import type { Database } from "@/lib/database.types";

type BillingRunRow = Database["public"]["Tables"]["billing_runs"]["Row"] & {
  triggered_by_email: string | null;
};
type BillingAttemptRow = Database["public"]["Tables"]["wishlist_billing_attempts"]["Row"] & {
  organization_name: string | null;
  product_name: string | null;
};

export default function BillingRunsPanel({
  conferenceId,
  initialRuns,
  initialAttempts,
}: {
  conferenceId: string;
  initialRuns: BillingRunRow[];
  initialAttempts: BillingAttemptRow[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [attempts, setAttempts] = useState(initialAttempts);
  const [selectedRunId, setSelectedRunId] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshRuns = async () => {
    setIsLoading(true);
    setError(null);
    setSelectedRunId("all");
    const result = await listBillingRunsForConference({ conferenceId, limit: 25 });
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    setRuns(result.data);
    const attemptsResult = await listWishlistBillingAttemptsForConference({
      conferenceId,
      limit: 50,
    });
    if (!attemptsResult.success) {
      setError(attemptsResult.error);
      setIsLoading(false);
      return;
    }
    setAttempts(attemptsResult.data);
    setIsLoading(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Billing Runs</h3>
        <button
          type="button"
          onClick={refreshRuns}
          disabled={isLoading}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Started</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Completed</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Processed</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Success</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Failed</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Triggered By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "n/a"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {run.completed_at ? new Date(run.completed_at).toLocaleString() : "n/a"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{run.status}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{run.total_items ?? 0}</td>
                <td className="px-4 py-3 text-sm text-green-700">{run.successful_items ?? 0}</td>
                <td className="px-4 py-3 text-sm text-red-700">{run.failed_items ?? 0}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{run.triggered_by_email ?? "unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Attempts filter</label>
          <select
            value={selectedRunId}
            onChange={async (event) => {
              const nextRunId = event.target.value;
              setSelectedRunId(nextRunId);
              const attemptsResult = await listWishlistBillingAttemptsForConference({
                conferenceId,
                billingRunId: nextRunId === "all" ? undefined : nextRunId,
                limit: 50,
              });
              if (!attemptsResult.success) {
                setError(attemptsResult.error);
                return;
              }
              setAttempts(attemptsResult.data);
              setError(null);
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="all">All runs</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id.slice(0, 8)} ({run.status})
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Attempted</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Intent</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Org</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Attempt #</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Stripe</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {new Date(attempt.attempted_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">{attempt.wishlist_intent_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{attempt.organization_name ?? "unknown"}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{attempt.product_name ?? "unknown"}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{attempt.attempt_number}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{attempt.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {attempt.amount_cents} {attempt.currency}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-gray-600">
                    PI: {attempt.stripe_payment_intent_id?.slice(0, 12) ?? "n/a"}
                    <br />
                    CH: {attempt.stripe_charge_id?.slice(0, 12) ?? "n/a"}
                    <br />
                    EC: {attempt.stripe_error_code ?? "n/a"}
                    {attempt.stripe_decline_code ? ` / ${attempt.stripe_decline_code}` : ""}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{attempt.error_message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
