"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ScheduleOpsAssignment,
  ScheduleOpsSlot,
} from "@/lib/conference/schedule-ops";
import { computeCoverage, type MatrixParticipant, type ScheduleMatrixData } from "@/lib/conference/schedule-coverage";
import {
  clearMeetingAssignment,
  setMeetingAssignment,
} from "@/lib/actions/conference-schedule-assign";

/**
 * The meeting matrix — review how the buyer/seller meeting blocks are filling
 * in, from whichever lens answers the question in front of you: the suite×slot
 * grid (is the room full), per-exhibitor and per-delegate itineraries (what
 * does X's day look like), and coverage (who isn't scheduled yet). Read-only;
 * bulk run generation lives in Schedule Ops, manual cell overrides are next.
 */

type Lens = "grid" | "exhibitor" | "delegate" | "coverage";

const LENSES: Array<{ key: Lens; label: string }> = [
  { key: "grid", label: "Suite × slot" },
  { key: "exhibitor", label: "By exhibitor" },
  { key: "delegate", label: "By delegate" },
  { key: "coverage", label: "Coverage" },
];

type EditingCell = {
  meetingSlotId: string;
  dayNumber: number;
  slotNumber: number;
  suiteNumber: number;
  startTime: string;
  endTime: string;
  assignment: ScheduleOpsAssignment | null;
};

function hm(t: string): string {
  return t.slice(0, 5);
}
function byDaySlot(a: { dayNumber: number; slotNumber: number }, b: { dayNumber: number; slotNumber: number }) {
  return a.dayNumber - b.dayNumber || a.slotNumber - b.slotNumber;
}

export default function MeetingMatrix({
  conferenceId,
  data,
}: {
  conferenceId: string;
  data: ScheduleMatrixData;
}) {
  const { summary } = data;
  const router = useRouter();
  const [lens, setLens] = useState<Lens>("grid");
  const [editing, setEditing] = useState<EditingCell | null>(null);

  const usingActive = summary.activeAssignments.length > 0;
  const assignments = usingActive ? summary.activeAssignments : summary.selectedAssignments;
  // Edits target the run whose assignments are on screen.
  const editRunId = usingActive ? summary.activeRunId : summary.selectedRunId;
  const runLabel = usingActive
    ? "Active schedule"
    : assignments.length > 0
      ? "Draft (not yet promoted)"
      : "No assignments yet";

  const suites = summary.suites;
  const slots = summary.slots;
  const suiteNumberById = useMemo(
    () => new Map(suites.map((s) => [s.id, s.suiteNumber] as const)),
    [suites]
  );
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s] as const)), [slots]);
  const assignmentBySlot = useMemo(
    () => new Map(assignments.map((a) => [a.meetingSlotId, a] as const)),
    [assignments]
  );

  const hasGrid = slots.length > 0 && suites.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Meeting matrix</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {runLabel}
            {assignments.length > 0 ? ` · ${assignments.length} meeting${assignments.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Link
          href={`/admin/conference/${conferenceId}/schedule-ops`}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Generate / promote in Schedule Ops
        </Link>
      </div>

      {!hasGrid ? (
        <div className="px-4 py-6 text-sm text-gray-600">
          No meeting grid yet. Set meeting days + suites in <strong>Meeting setup</strong> above, then
          generate a run in{" "}
          <Link
            href={`/admin/conference/${conferenceId}/schedule-ops`}
            className="font-medium text-accent hover:underline"
          >
            Schedule Ops
          </Link>
          .
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
            {LENSES.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLens(l.key)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  lens === l.key
                    ? "border-accent bg-blue-50 text-accent"
                    : "border-gray-300 text-gray-600 hover:border-accent"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {!usingActive && assignments.length === 0 && (
            <div className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The grid scaffolding exists but no run has been promoted. Showing empty cells — generate
              and promote a run in Schedule Ops to populate it.
            </div>
          )}

          <div className="p-4">
            {lens === "grid" && (
              <GridLens
                slots={slots}
                suites={suites}
                assignmentBySlot={assignmentBySlot}
                onEditCell={editRunId ? (cell) => setEditing(cell) : undefined}
              />
            )}
            {lens === "exhibitor" && (
              <ExhibitorLens assignments={assignments} slotById={slotById} suiteNumberById={suiteNumberById} />
            )}
            {lens === "delegate" && (
              <DelegateLens assignments={assignments} slotById={slotById} suiteNumberById={suiteNumberById} />
            )}
            {lens === "coverage" && <CoverageLens data={data} assignments={assignments} />}
          </div>
        </>
      )}

      {editing && editRunId && (
        <CellEditor
          conferenceId={conferenceId}
          runId={editRunId}
          cell={editing}
          exhibitors={data.exhibitors}
          delegates={data.delegates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function GridLens({
  slots,
  suites,
  assignmentBySlot,
  onEditCell,
}: {
  slots: ScheduleOpsSlot[];
  suites: ScheduleMatrixData["summary"]["suites"];
  assignmentBySlot: Map<string, ScheduleOpsAssignment>;
  onEditCell?: (cell: EditingCell) => void;
}) {
  const rows = useMemo(() => {
    const map = new Map<string, ScheduleOpsSlot[]>();
    for (const s of slots) {
      const key = `${s.dayNumber}:${s.slotNumber}`;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.values()]
      .map((list) => list)
      .sort((a, b) => byDaySlot(a[0], b[0]));
  }, [slots]);

  return (
    <div>
      {onEditCell && (
        <p className="mb-2 text-[11px] text-gray-500">
          Click any cell to assign, change, or clear its meeting. Hand edits are marked{" "}
          <span className="rounded bg-amber-200 px-1 text-[9px] font-semibold uppercase text-amber-800">
            manual
          </span>
          .
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold text-gray-700">
              Day / Slot
            </th>
            {suites.map((s) => (
              <th key={s.id} className="px-2 py-2 text-left font-semibold text-gray-700">
                Suite {s.suiteNumber}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowSlots) => {
            const first = rowSlots[0];
            const bySuite = new Map(rowSlots.map((s) => [s.suiteId, s] as const));
            return (
              <tr key={`${first.dayNumber}:${first.slotNumber}`}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 align-top text-gray-700">
                  <div className="font-medium">
                    Day {first.dayNumber} · Slot {first.slotNumber}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {hm(first.startTime)}–{hm(first.endTime)}
                  </div>
                </td>
                {suites.map((suite) => {
                  const slot = bySuite.get(suite.id);
                  const assignment = slot ? assignmentBySlot.get(slot.id) : undefined;
                  const content = assignment ? (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-emerald-900">
                          {assignment.exhibitorOrganizationName}
                        </span>
                        {assignment.isManual && (
                          <span className="rounded bg-amber-200 px-1 text-[9px] font-semibold uppercase text-amber-800">
                            manual
                          </span>
                        )}
                      </div>
                      <div className="text-emerald-700">
                        {assignment.delegateNames.length > 0
                          ? assignment.delegateNames.join(", ")
                          : "No delegates"}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-300">empty</span>
                  );
                  return (
                    <td key={suite.id} className="px-1 py-1 align-top">
                      {onEditCell && slot ? (
                        <button
                          type="button"
                          onClick={() =>
                            onEditCell({
                              meetingSlotId: slot.id,
                              dayNumber: slot.dayNumber,
                              slotNumber: slot.slotNumber,
                              suiteNumber: suite.suiteNumber,
                              startTime: slot.startTime,
                              endTime: slot.endTime,
                              assignment: assignment ?? null,
                            })
                          }
                          className={`block w-full rounded border px-2 py-1 text-left transition-colors ${
                            assignment
                              ? "border-emerald-200 bg-emerald-50 hover:border-emerald-400"
                              : "border-dashed border-gray-200 hover:border-accent hover:text-accent"
                          }`}
                        >
                          {content}
                        </button>
                      ) : (
                        <div
                          className={`rounded border px-2 py-1 ${
                            assignment
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-dashed border-gray-200"
                          }`}
                        >
                          {content}
                        </div>
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
    </div>
  );
}

function ExhibitorLens({
  assignments,
  slotById,
  suiteNumberById,
}: {
  assignments: ScheduleOpsAssignment[];
  slotById: Map<string, ScheduleOpsSlot>;
  suiteNumberById: Map<string, number>;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; meetings: ScheduleOpsAssignment[] }>();
    for (const a of assignments) {
      const g = m.get(a.exhibitorRegistrationId) ?? { name: a.exhibitorOrganizationName, meetings: [] };
      g.meetings.push(a);
      m.set(a.exhibitorRegistrationId, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, meetings: [...g.meetings].sort(byDaySlot) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments]);

  if (groups.length === 0) return <Empty text="No exhibitor meetings in this run yet." />;

  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <ItineraryCard
          key={i}
          title={g.name}
          subtitle={`${g.meetings.length} meeting${g.meetings.length === 1 ? "" : "s"}`}
          rows={g.meetings.map((m) => ({
            when: `Day ${m.dayNumber} · Slot ${m.slotNumber}`,
            time: slotTime(m, slotById),
            where: `Suite ${suiteNumberById.get(m.suiteId) ?? "?"}`,
            who: m.delegateNames.length > 0 ? m.delegateNames.join(", ") : "No delegates",
          }))}
        />
      ))}
    </div>
  );
}

function DelegateLens({
  assignments,
  slotById,
  suiteNumberById,
}: {
  assignments: ScheduleOpsAssignment[];
  slotById: Map<string, ScheduleOpsSlot>;
  suiteNumberById: Map<string, number>;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; meetings: ScheduleOpsAssignment[] }>();
    for (const a of assignments) {
      a.delegateRegistrationIds.forEach((id, idx) => {
        const g = m.get(id) ?? { name: a.delegateNames[idx] ?? id, meetings: [] };
        g.meetings.push(a);
        m.set(id, g);
      });
    }
    return [...m.values()]
      .map((g) => ({ ...g, meetings: [...g.meetings].sort(byDaySlot) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments]);

  if (groups.length === 0) return <Empty text="No delegate meetings in this run yet." />;

  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <ItineraryCard
          key={i}
          title={g.name}
          subtitle={`${g.meetings.length} meeting${g.meetings.length === 1 ? "" : "s"}`}
          rows={g.meetings.map((m) => ({
            when: `Day ${m.dayNumber} · Slot ${m.slotNumber}`,
            time: slotTime(m, slotById),
            where: `Suite ${suiteNumberById.get(m.suiteId) ?? "?"}`,
            who: m.exhibitorOrganizationName,
          }))}
        />
      ))}
    </div>
  );
}

function CoverageLens({
  data,
  assignments,
}: {
  data: ScheduleMatrixData;
  assignments: ScheduleOpsAssignment[];
}) {
  const cov = useMemo(
    () => computeCoverage(data.summary.slots, assignments, data.delegates, data.exhibitors),
    [data, assignments]
  );
  const suiteNumberById = new Map(data.summary.suites.map((s) => [s.id, s.suiteNumber] as const));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Grid filled" value={`${cov.fillPct}%`} sub={`${cov.filledCells} / ${cov.totalCells} cells`} />
        <Stat label="Meetings" value={String(cov.totalMeetings)} sub={`${cov.emptyCells} empty cells`} />
        <Stat
          label="Exhibitor-only"
          value={String(cov.exhibitorOnlyMeetings)}
          sub="meetings with no delegate"
          warn={cov.exhibitorOnlyMeetings > 0}
        />
        <Stat
          label="Unscheduled"
          value={String(cov.unscheduledExhibitors.length + cov.unscheduledDelegates.length)}
          sub={`${cov.unscheduledExhibitors.length} exhib · ${cov.unscheduledDelegates.length} deleg`}
          warn={cov.unscheduledExhibitors.length + cov.unscheduledDelegates.length > 0}
        />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Per-suite utilization
        </h3>
        <div className="space-y-1.5">
          {cov.suiteUtil
            .slice()
            .sort((a, b) => (suiteNumberById.get(a.suiteId) ?? 0) - (suiteNumberById.get(b.suiteId) ?? 0))
            .map((s) => {
              const pct = s.total > 0 ? Math.round((s.filled / s.total) * 100) : 0;
              return (
                <div key={s.suiteId} className="flex items-center gap-3 text-xs">
                  <span className="w-16 shrink-0 text-gray-600">Suite {suiteNumberById.get(s.suiteId) ?? "?"}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-gray-500">
                    {s.filled}/{s.total}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UnscheduledList title="Exhibitors not scheduled" people={cov.unscheduledExhibitors} />
        <UnscheduledList title="Delegates not scheduled" people={cov.unscheduledDelegates} />
      </div>
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────

function slotTime(a: ScheduleOpsAssignment, slotById: Map<string, ScheduleOpsSlot>): string {
  const slot = slotById.get(a.meetingSlotId);
  return slot ? `${hm(slot.startTime)}–${hm(slot.endTime)}` : "";
}

function ItineraryCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ when: string; time: string; where: string; who: string }>;
}) {
  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <span className="text-[11px] text-gray-500">{subtitle}</span>
      </div>
      <table className="min-w-full text-xs">
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-gray-700">
                {r.when} <span className="text-gray-400">{r.time}</span>
              </td>
              <td className="px-3 py-1.5 text-gray-600">{r.where}</td>
              <td className="px-3 py-1.5 text-gray-900">{r.who}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${warn ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
      <p className={`text-xs uppercase tracking-wide ${warn ? "text-amber-700" : "text-gray-500"}`}>{label}</p>
      <p className={`mt-1 text-lg font-semibold ${warn ? "text-amber-900" : "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}

function UnscheduledList({
  title,
  people,
}: {
  title: string;
  people: Array<{ registrationId: string; name: string; orgName: string | null }>;
}) {
  return (
    <div className="rounded-md border border-gray-200">
      <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
        {title} · {people.length}
      </div>
      {people.length === 0 ? (
        <p className="px-3 py-2 text-xs text-emerald-700">Everyone is scheduled. 🎉</p>
      ) : (
        <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto">
          {people.map((p) => (
            <li key={p.registrationId} className="px-3 py-1.5 text-xs text-gray-700">
              {p.name}
              {p.orgName && <span className="ml-1 text-gray-400">· {p.orgName}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function exhibitorLabel(p: MatrixParticipant): string {
  if (p.orgName) return p.name && p.name !== p.orgName ? `${p.orgName} — ${p.name}` : p.orgName;
  return p.name;
}

function CellEditor({
  conferenceId,
  runId,
  cell,
  exhibitors,
  delegates,
  onClose,
  onSaved,
}: {
  conferenceId: string;
  runId: string;
  cell: EditingCell;
  exhibitors: MatrixParticipant[];
  delegates: MatrixParticipant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [exhibitorId, setExhibitorId] = useState(cell.assignment?.exhibitorRegistrationId ?? "");
  const [delegateIds, setDelegateIds] = useState<string[]>(
    cell.assignment?.delegateRegistrationIds ?? []
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredDelegates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return delegates;
    return delegates.filter(
      (d) =>
        d.name.toLowerCase().includes(needle) ||
        (d.orgName ?? "").toLowerCase().includes(needle)
    );
  }, [delegates, q]);

  async function save() {
    if (!exhibitorId) {
      setError("Pick an exhibitor.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setMeetingAssignment(conferenceId, {
      runId,
      meetingSlotId: cell.meetingSlotId,
      exhibitorRegistrationId: exhibitorId,
      delegateRegistrationIds: delegateIds,
    });
    setBusy(false);
    if (res.success) onSaved();
    else setError(res.error);
  }

  async function clear() {
    setBusy(true);
    setError(null);
    const res = await clearMeetingAssignment(conferenceId, {
      runId,
      meetingSlotId: cell.meetingSlotId,
    });
    setBusy(false);
    if (res.success) onSaved();
    else setError(res.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Suite {cell.suiteNumber} · Day {cell.dayNumber} · Slot {cell.slotNumber}
            </h3>
            <p className="text-xs text-gray-500">
              {hm(cell.startTime)}–{hm(cell.endTime)} · hand-editing this meeting
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        {exhibitors.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-600">
            No eligible exhibitor registrations yet. Add submitted/confirmed exhibitor registrations
            before assigning meetings.
          </div>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <label className="block text-xs text-gray-500">
              Exhibitor
              <select
                value={exhibitorId}
                onChange={(e) => setExhibitorId(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">— pick an exhibitor —</option>
                {exhibitors.map((p) => (
                  <option key={p.registrationId} value={p.registrationId}>
                    {exhibitorLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Delegates · {delegateIds.length} selected</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  className="w-32 rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
              <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded border border-gray-200 p-2">
                {delegates.length === 0 ? (
                  <p className="text-xs text-gray-400">No eligible delegates yet.</p>
                ) : filteredDelegates.length === 0 ? (
                  <p className="text-xs text-gray-400">No delegates match.</p>
                ) : (
                  filteredDelegates.map((d) => {
                    const checked = delegateIds.includes(d.registrationId);
                    return (
                      <label
                        key={d.registrationId}
                        className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDelegateIds((prev) =>
                              e.target.checked
                                ? [...prev, d.registrationId]
                                : prev.filter((id) => id !== d.registrationId)
                            )
                          }
                        />
                        <span>{d.name}</span>
                        {d.orgName && <span className="text-gray-400">· {d.orgName}</span>}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          <div>
            {cell.assignment && (
              <button
                type="button"
                onClick={() => void clear()}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Clear cell
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || exhibitors.length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save meeting"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">{text}</div>;
}
