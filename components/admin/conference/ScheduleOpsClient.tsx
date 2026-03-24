"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ScheduleOpsAssignment, ScheduleOpsSummary } from "@/lib/conference/schedule-ops";

type ScheduleOpsClientProps = {
  conferenceId: string;
  initialSummary: ScheduleOpsSummary;
  canPromote: boolean;
};

type DiffRow = {
  key: string;
  dayNumber: number;
  slotNumber: number;
  suiteNumber: number | null;
  changeType: "added" | "removed" | "replaced";
  activeLabel: string;
  draftLabel: string;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleString();
}

function formatTimeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
}

function assignmentLabel(assignment: ScheduleOpsAssignment | undefined): string {
  if (!assignment) return "—";
  return `${assignment.exhibitorOrganizationName} (${assignment.delegateNames.join(", ") || "No delegates"})`;
}

function assignmentSignature(assignment: ScheduleOpsAssignment | undefined): string {
  if (!assignment) return "";
  return `${assignment.exhibitorRegistrationId}|${[...assignment.delegateRegistrationIds]
    .sort()
    .join(",")}`;
}

export default function ScheduleOpsClient({
  conferenceId,
  initialSummary,
  canPromote,
}: ScheduleOpsClientProps) {
  const [summary, setSummary] = useState<ScheduleOpsSummary>(initialSummary);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    initialSummary.selectedRunId
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(
    Date.parse(initialSummary.generatedAt) || Date.now()
  );

  async function loadSummary(nextSelectedRunId?: string | null) {
    const selected = nextSelectedRunId ?? selectedRunId ?? "";
    const query = selected ? `?selectedRunId=${encodeURIComponent(selected)}` : "";
    const response = await fetch(
      `/api/admin/conference/${conferenceId}/schedule-ops/summary${query}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to refresh schedule operations.");
    }
    const payload = (await response.json()) as ScheduleOpsSummary;
    setSummary(payload);
    setSelectedRunId(payload.selectedRunId);
    setLastFetchedAt(Date.parse(payload.generatedAt) || Date.now());
  }

  useEffect(() => {
    const pollTimer = window.setInterval(() => {
      void loadSummary().catch(() => {
        // polling failure is reflected by stale marker
      });
    }, 25_000);

    const supabase = createClient();
    const channel = supabase
      .channel(`schedule-ops-${conferenceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scheduler_runs",
          filter: `conference_id=eq.${conferenceId}`,
        },
        () => {
          void loadSummary().catch(() => {});
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedules",
          filter: `conference_id=eq.${conferenceId}`,
        },
        () => {
          void loadSummary().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId]);

  const runsById = useMemo(
    () => new Map(summary.runs.map((run) => [run.id, run] as const)),
    [summary.runs]
  );

  const selectedRun = selectedRunId ? runsById.get(selectedRunId) ?? null : null;
  const activeRun = summary.activeRunId ? runsById.get(summary.activeRunId) ?? null : null;
  const isStale = Date.now() - lastFetchedAt > 30_000;
  const snapshotTimestamp = formatTimestamp(summary.generatedAt);
  const latestRunTimestamp = formatTimestamp(summary.latestRunUpdatedAt);

  const selectedAssignmentBySlot = useMemo(() => {
    return new Map(summary.selectedAssignments.map((row) => [row.meetingSlotId, row] as const));
  }, [summary.selectedAssignments]);
  const activeAssignmentBySlot = useMemo(() => {
    return new Map(summary.activeAssignments.map((row) => [row.meetingSlotId, row] as const));
  }, [summary.activeAssignments]);

  const diffRows = useMemo<DiffRow[]>(() => {
    const rows: DiffRow[] = [];
    for (const slot of summary.slots) {
      const active = activeAssignmentBySlot.get(slot.id);
      const draft = selectedAssignmentBySlot.get(slot.id);
      const activeSig = assignmentSignature(active);
      const draftSig = assignmentSignature(draft);
      if (activeSig === draftSig) continue;
      let changeType: DiffRow["changeType"] = "replaced";
      if (!active && draft) changeType = "added";
      if (active && !draft) changeType = "removed";

      const suiteNumber =
        summary.suites.find((suite) => suite.id === slot.suiteId)?.suiteNumber ?? null;
      rows.push({
        key: slot.id,
        dayNumber: slot.dayNumber,
        slotNumber: slot.slotNumber,
        suiteNumber,
        changeType,
        activeLabel: assignmentLabel(active),
        draftLabel: assignmentLabel(draft),
      });
    }
    return rows.sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
      if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
      return (a.suiteNumber ?? 0) - (b.suiteNumber ?? 0);
    });
  }, [summary.slots, summary.suites, activeAssignmentBySlot, selectedAssignmentBySlot]);

  const groupedSlots = useMemo(() => {
    const map = new Map<string, (typeof summary.slots)[number][]>();
    for (const slot of summary.slots) {
      const key = `${slot.dayNumber}:${slot.slotNumber}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, slots]) => ({ key, slots }))
      .sort((a, b) => {
        const [aDay, aSlot] = a.key.split(":").map(Number);
        const [bDay, bSlot] = b.key.split(":").map(Number);
        if (aDay !== bDay) return aDay - bDay;
        return aSlot - bSlot;
      });
  }, [summary]);

  async function onGenerateDraft() {
    setIsActing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/schedule-ops/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "generate_draft" }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to generate draft run.");
      await loadSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to generate draft run.");
    } finally {
      setIsActing(false);
    }
  }

  async function onPromote(runId: string) {
    setIsActing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/schedule-ops/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "promote", runId }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to promote run.");
      await loadSummary(runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to promote run.");
    } finally {
      setIsActing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Run Control</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                void loadSummary().finally(() => setIsLoading(false));
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              disabled={isLoading || isActing}
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={onGenerateDraft}
              className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
              disabled={isActing}
            >
              Generate Draft
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Active Run</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {activeRun ? `${activeRun.runMode} / ${activeRun.status}` : "None"}
            </p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Selected Run</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {selectedRun ? `${selectedRun.runMode} / ${selectedRun.status}` : "None"}
            </p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Changed Cells</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{diffRows.length}</p>
          </div>
          <div
            className={`rounded border p-3 ${
              isStale ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50"
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">View Freshness</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {isStale ? "Stale (>30s)" : "Fresh"}
            </p>
          </div>
        </div>
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            isStale
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-gray-200 bg-gray-50 text-gray-700"
          }`}
        >
          <p className="font-semibold">
            {isStale ? "Stale view warning" : "Schedule version"}
          </p>
          <p className="mt-1">
            Snapshot captured: {snapshotTimestamp}. Latest run update: {latestRunTimestamp}.
          </p>
          {isStale ? (
            <p className="mt-1">
              This view is older than 30 seconds. Refresh now to confirm run and assignment state.
            </p>
          ) : null}
        </div>

        <label className="mt-3 block text-sm text-gray-700">
          Compare draft/archived run
          <select
            value={selectedRunId ?? ""}
            onChange={(event) => {
              const nextId = event.target.value || null;
              setSelectedRunId(nextId);
              setIsLoading(true);
              void loadSummary(nextId).finally(() => setIsLoading(false));
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          >
            {summary.runs.length === 0 ? <option value="">No runs yet</option> : null}
            {summary.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.runMode} / {run.status} / {new Date(run.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        {selectedRun && selectedRun.runMode === "draft" ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void onPromote(selectedRun.id)}
              disabled={isActing || !canPromote || selectedRun.status !== "completed"}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Promote Selected Draft to Active
            </button>
            {!canPromote ? (
              <p className="mt-1 text-xs text-gray-500">Only super_admin can promote runs.</p>
            ) : null}
            {selectedRun.status !== "completed" ? (
              <p className="mt-1 text-xs text-gray-500">Only completed draft runs are promotable.</p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </section>

      {selectedRun && (selectedRun.status === "failed" || selectedRun.status === "infeasible") ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-900">Run Diagnostics</h3>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs text-red-900">
            {JSON.stringify(selectedRun.diagnostics ?? {}, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Draft vs Active Diff</h3>
        {diffRows.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No assignment changes between selected and active runs.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Slot</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Suite</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Change</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Active</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Selected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {diffRows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2 text-gray-700">
                      Day {row.dayNumber} / Slot {row.slotNumber}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.suiteNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{row.changeType}</td>
                    <td className="px-3 py-2 text-gray-700">{row.activeLabel}</td>
                    <td className="px-3 py-2 text-gray-700">{row.draftLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Occupancy Grid (Selected Run)</h3>
        {summary.slots.length === 0 || summary.suites.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No slot/suite scaffolding exists yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold text-gray-700">Day/Slot</th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-700">Time</th>
                  {summary.suites.map((suite) => (
                    <th key={suite.id} className="px-2 py-2 text-left font-semibold text-gray-700">
                      Suite {suite.suiteNumber}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groupedSlots.map((group) => {
                  const firstSlot = group.slots[0];
                  const slotBySuite = new Map(group.slots.map((slot) => [slot.suiteId, slot] as const));
                  return (
                    <tr key={group.key}>
                      <td className="px-2 py-2 text-gray-700">
                        Day {firstSlot.dayNumber} / Slot {firstSlot.slotNumber}
                      </td>
                      <td className="px-2 py-2 text-gray-700">
                        {formatTimeRange(firstSlot.startTime, firstSlot.endTime)}
                      </td>
                      {summary.suites.map((suite) => {
                        const slot = slotBySuite.get(suite.id);
                        const assignment = slot
                          ? selectedAssignmentBySlot.get(slot.id)
                          : undefined;
                        return (
                          <td key={suite.id} className="px-2 py-2 text-gray-700 align-top">
                            {assignment ? (
                              <div className="space-y-1 rounded border border-gray-200 bg-white p-2">
                                <p className="font-medium text-gray-900">
                                  {assignment.exhibitorOrganizationName}
                                </p>
                                <p className="text-gray-600">
                                  {assignment.delegateNames.join(", ") || "No delegates"}
                                </p>
                              </div>
                            ) : (
                              <span className="rounded bg-gray-100 px-2 py-1 text-gray-500">
                                Empty (unsold/unused)
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
