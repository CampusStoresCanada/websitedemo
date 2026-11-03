"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmAction from "@/components/ui/ConfirmAction";
import { ReprintModal } from "./PrintTab";
import type { ConferencePerson } from "./shared";

const POLL_MS = 30_000;
const STALE_MS = POLL_MS * 2;

/**
 * People: the conference's people, a drawer per person, and the per-person
 * Operate actions — check in by hand, reprint (the Print tab's), admin notes.
 * Loads and polls its own rows while it is open; nothing else on the page waits
 * for them.
 */
export function PeopleView({
  conferenceId,
  syncPeopleIndex,
}: {
  conferenceId: string;
  /** Rebuilds the people index — the only tab it affects is People. */
  syncPeopleIndex: () => Promise<void>;
}) {
  // The War Room is for admins (WAR_ROOM_OPERATE_PLAN §2).
  const canEditAdminNotes = true;
  const [rows, setRows] = useState<ConferencePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personKind, setPersonKind] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [badgeStatus, setBadgeStatus] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [reprintPerson, setReprintPerson] = useState<{ id: string; name: string | null } | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(Date.now());

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const isStale = Date.now() - lastSuccessAt > STALE_MS;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (personKind) params.set("person_kind", personKind);
    if (assignmentStatus) params.set("assignment_status", assignmentStatus);
    if (badgeStatus) params.set("badge_status", badgeStatus);
    if (checkIn) params.set("check_in", checkIn);
    return params.toString();
  }, [assignmentStatus, badgeStatus, checkIn, personKind, search]);

  const fetchRows = useCallback(
    () =>
      fetch(`/api/admin/conference/${conferenceId}/war-room${query ? `?${query}` : ""}`, { cache: "no-store" }).then(
        async (response) => {
          const payload = (await response.json()) as { rows?: ConferencePerson[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Failed to load data.");
          return payload.rows ?? [];
        }
      ),
    [conferenceId, query]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchRows());
      setError(null);
      setLastSuccessAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load war-room data.");
    } finally {
      setLoading(false);
    }
  }, [fetchRows]);

  // Polling only while this tab is mounted, which is only while it is open.
  useEffect(() => {
    let live = true;
    const tick = () =>
      void fetchRows()
        .then((next) => {
          if (!live) return;
          setRows(next);
          setError(null);
          setLastSuccessAt(Date.now());
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (!live) return;
          setError(err instanceof Error ? err.message : "Failed to load war-room data.");
          setLoading(false);
        });
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [fetchRows]);

  const select = (row: ConferencePerson) => {
    setSelectedId(row.id);
    setNoteDraft(row.admin_notes ?? "");
  };

  const runPersonOp = async (personId: string, op: "update" | "manual_check_in", patch?: Record<string, unknown>) => {
    const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, patch }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operation failed.");
    await load();
  };

  return (
    <>
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Filters</h2>
          {/* Moved from the War Room's header: People is the only thing it touches. */}
          <ConfirmAction
            label="Sync People Index"
            consequence="Rebuilds this conference's people list from registrations and seats. Nobody is emailed."
            onConfirm={async () => {
              await syncPeopleIndex();
              await load();
            }}
          />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name/email/org"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={personKind}
            onChange={(e) => setPersonKind(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All kinds</option>
            <option value="delegate">Delegate</option>
            <option value="exhibitor">Exhibitor</option>
            <option value="staff">Staff</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select
            value={assignmentStatus}
            onChange={(e) => setAssignmentStatus(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All assignment states</option>
            <option value="assigned">Assigned</option>
            <option value="pending_user_activation">Pending Activation</option>
            <option value="unassigned">Unassigned</option>
            <option value="reassigned">Reassigned</option>
            <option value="canceled">Canceled</option>
          </select>
          <select
            value={badgeStatus}
            onChange={(e) => setBadgeStatus(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All badge states</option>
            <option value="not_printed">Not Printed</option>
            <option value="printed">Printed</option>
            <option value="reprinted">Reprinted</option>
          </select>
          <select
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All check-in states</option>
            <option value="checked_in">Checked In</option>
            <option value="not_checked_in">Not Checked In</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">Degraded mode: {error}</p> : null}
        {isStale ? (
          <p className="mt-1 text-sm text-amber-700">Data is stale. Refresh before applying manual actions.</p>
        ) : null}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Master Table</h2>
          {loading ? <span className="text-xs text-gray-500">Refreshing…</span> : null}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Person</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Role</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Assignment</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Badge</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Check-in</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Travel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-gray-500" colSpan={6}>
                    {loading ? "Loading people…" : "No rows found."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer hover:bg-gray-50" onClick={() => select(row)}>
                    <td className="px-3 py-2 text-gray-900">{row.display_name ?? row.contact_email ?? row.id}</td>
                    <td className="px-3 py-2 text-gray-700">{row.person_kind}</td>
                    <td className="px-3 py-2 text-gray-700">{row.assignment_status}</td>
                    <td className="px-3 py-2 text-gray-700">{row.badge_print_status}</td>
                    <td className="px-3 py-2 text-gray-700">{row.checked_in_at ? "Checked In" : "Not Checked In"}</td>
                    <td className="px-3 py-2 text-gray-700">{row.travel_mode ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Detail Drawer</h2>
          <p className="mt-1 text-sm text-gray-600">{selected.display_name ?? selected.contact_email ?? selected.id}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-3 text-sm">
              <p className="font-medium text-gray-900">Travel / Hotel</p>
              <p className="mt-1 text-gray-700">Mode: {selected.travel_mode ?? "—"}</p>
              <p className="text-gray-700">Hotel: {selected.hotel_name ?? "—"}</p>
              <p className="text-gray-700">Confirmation: {selected.hotel_confirmation_code ?? "—"}</p>
              <p className="text-gray-700">Dietary: {selected.dietary_restrictions ? "Flagged" : "None"}</p>
              <p className="text-gray-700">Accessibility: {selected.accessibility_needs ? "Flagged" : "None"}</p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3 text-sm">
              <p className="font-medium text-gray-900">Quick Actions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ConfirmAction
                  label="Check in by hand"
                  consequence={`Records ${selected.display_name ?? "this person"} as checked in now, without a scan.`}
                  disabled={isStale}
                  onConfirm={async () => {
                    try {
                      await runPersonOp(selected.id, "manual_check_in");
                      return { success: true };
                    } catch (err) {
                      return { success: false, error: err instanceof Error ? err.message : "Couldn't check them in." };
                    }
                  }}
                />
                {/* The Print tab's reprint, for this person. */}
                <button
                  type="button"
                  onClick={() => setReprintPerson({ id: selected.id, name: selected.display_name })}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Reprint badge…
                </button>
              </div>
              {canEditAdminNotes ? (
                <>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                    rows={4}
                    placeholder="Admin notes"
                  />
                  <button
                    type="button"
                    disabled={isStale}
                    onClick={() => void runPersonOp(selected.id, "update", { admin_notes: noteDraft })}
                    className="mt-2 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save Notes
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {reprintPerson ? (
        <ReprintModal
          key={reprintPerson.id}
          conferenceId={conferenceId}
          people={rows}
          person={reprintPerson}
          onClose={() => {
            setReprintPerson(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
