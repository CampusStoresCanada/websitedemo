import Link from "next/link";
import { isCircleConfigured } from "@/lib/circle/config";
import { createAdminClient } from "@/lib/supabase/admin";

interface CircleSyncStatusCardProps {
  orgId: string;
  orgSlug: string;
}

/**
 * Server component — shows Circle integration status for an organization.
 *
 * Displays:
 * - Whether Circle integration is configured (env vars present)
 * - Whether the org has a linked circle_id
 * - Pending sync queue items
 * - Recent sync errors (last 24h)
 *
 * Gracefully degrades to a "not configured" card if Circle env vars are missing.
 */
export async function CircleSyncStatusCard({
  orgId,
  orgSlug,
}: CircleSyncStatusCardProps) {
  const configured = isCircleConfigured();

  if (!configured) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Circle Sync</h2>
        </div>
        <p className="text-sm text-gray-400">Not configured</p>
        <p className="text-xs text-gray-400 mt-1">
          Circle API credentials not set
        </p>
      </div>
    );
  }

  // Fetch org data and sync status
  const adminClient = createAdminClient();

  const [orgResult, pendingResult, recentErrorsResult] = await Promise.all([
    // Get the org's circle_id
    adminClient
      .from("organizations")
      .select("circle_id")
      .eq("id", orgId)
      .single(),

    // Count pending sync queue items for this org
    adminClient
      .from("circle_sync_queue")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", orgId)
      .in("status", ["pending", "processing"]),

    // Recent errors (last 24h) for this org
    adminClient
      .from("circle_sync_queue")
      .select("id, operation, last_error, created_at")
      .eq("entity_id", orgId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const circleId = orgResult.data?.circle_id ?? null;
  const pendingCount = pendingResult.count ?? 0;
  const recentErrors = recentErrorsResult.data ?? [];

  // Also check for pending items tied to contacts in this org
  const { count: contactPendingCount } = await adminClient
    .from("circle_sync_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .contains("payload", { orgId });

  const totalPending = pendingCount + (contactPendingCount ?? 0);

  const [pendingMappingOps, failedMappingOps] = await Promise.all([
    adminClient
      .from("circle_sync_queue")
      .select("operation")
      .in("status", ["pending", "processing"])
      .in("operation", [
        "add_tag",
        "remove_tag",
        "add_to_access_group",
        "remove_from_access_group",
        "add_to_space",
        "remove_from_space",
      ])
      .or(`entity_id.eq.${orgId},payload->>orgId.eq.${orgId}`)
      .limit(200),
    adminClient
      .from("circle_sync_queue")
      .select("operation")
      .eq("status", "failed")
      .in("operation", [
        "add_tag",
        "remove_tag",
        "add_to_access_group",
        "remove_from_access_group",
        "add_to_space",
        "remove_from_space",
      ])
      .or(`entity_id.eq.${orgId},payload->>orgId.eq.${orgId}`)
      .limit(200),
  ]);

  const pendingRows = pendingMappingOps.data ?? [];
  const failedRows = failedMappingOps.data ?? [];

  const pendingTagOps = pendingRows.filter(
    (row) => row.operation === "add_tag" || row.operation === "remove_tag"
  ).length;
  const pendingAccessGroupOps = pendingRows.filter(
    (row) =>
      row.operation === "add_to_access_group" ||
      row.operation === "remove_from_access_group"
  ).length;
  const pendingSpaceOps = pendingRows.filter(
    (row) =>
      row.operation === "add_to_space" || row.operation === "remove_from_space"
  ).length;

  const failedTagOps = failedRows.filter(
    (row) => row.operation === "add_tag" || row.operation === "remove_tag"
  ).length;
  const failedAccessGroupOps = failedRows.filter(
    (row) =>
      row.operation === "add_to_access_group" ||
      row.operation === "remove_from_access_group"
  ).length;
  const failedSpaceOps = failedRows.filter(
    (row) =>
      row.operation === "add_to_space" || row.operation === "remove_from_space"
  ).length;

  // Determine status color
  let statusColor: "green" | "yellow" | "red" | "gray";
  let statusLabel: string;

  if (recentErrors.length > 0) {
    statusColor = "red";
    statusLabel = `${recentErrors.length} recent error${recentErrors.length !== 1 ? "s" : ""}`;
  } else if (totalPending > 0) {
    statusColor = "yellow";
    statusLabel = `${totalPending} pending`;
  } else if (circleId) {
    statusColor = "green";
    statusLabel = "Linked";
  } else {
    statusColor = "gray";
    statusLabel = "Not linked";
  }

  const dotColors = {
    green: "bg-green-400",
    yellow: "bg-yellow-400",
    red: "bg-red-400",
    gray: "bg-gray-300",
  };

  const bgColors = {
    green: "bg-purple-50",
    yellow: "bg-purple-50",
    red: "bg-red-50",
    gray: "bg-gray-100",
  };

  const iconColors = {
    green: "text-purple-600",
    yellow: "text-purple-600",
    red: "text-red-600",
    gray: "text-gray-400",
  };

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
      <div className="flex items-center gap-3 mb-2">
        <div
          className={`w-10 h-10 ${bgColors[statusColor]} rounded-lg flex items-center justify-center`}
        >
          <svg
            className={`w-5 h-5 ${iconColors[statusColor]}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Circle Sync</h2>
      </div>

      {/* Status line */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${dotColors[statusColor]}`}
        />
        <p className="text-sm text-gray-700">{statusLabel}</p>
      </div>

      {/* Details */}
      <div className="mt-2 space-y-1">
        {circleId && (
          <p className="text-xs text-gray-400">
            Circle ID: {circleId}
          </p>
        )}
        {totalPending > 0 && (
          <p className="text-xs text-gray-500">
            {totalPending} sync operation{totalPending !== 1 ? "s" : ""} queued
          </p>
        )}
        {recentErrors.length > 0 && (
          <div className="mt-1">
            {recentErrors.slice(0, 2).map((err) => (
              <p key={err.id} className="text-xs text-red-500 truncate">
                {err.operation}: {err.last_error ?? "Unknown error"}
              </p>
            ))}
          </div>
        )}
        {!circleId && recentErrors.length === 0 && totalPending === 0 && (
          <p className="text-xs text-gray-400">
            Community integration status
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-3 space-y-1">
        <p className="text-xs font-medium text-gray-600">Org Mapping Sync</p>
        <p className="text-xs text-gray-500">
          Tags: {pendingTagOps} pending, {failedTagOps} recent failed
        </p>
        <p className="text-xs text-gray-500">
          Access Groups: {pendingAccessGroupOps} pending, {failedAccessGroupOps} recent failed
        </p>
        <p className="text-xs text-gray-500">
          Spaces: {pendingSpaceOps} pending, {failedSpaceOps} recent failed
        </p>
      </div>

      <p className="mt-2 text-[11px] text-gray-400">
        View more in <Link href={`/org/${orgSlug}/admin`} className="underline">Org Admin</Link>.
      </p>
    </div>
  );
}
