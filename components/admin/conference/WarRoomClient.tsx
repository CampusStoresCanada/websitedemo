"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ConferencePerson = {
  id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  organization_id: string;
  assignment_status: string;
  badge_print_status: string;
  checked_in_at: string | null;
  travel_mode: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  dietary_restrictions: string | null;
  accessibility_needs: string | null;
  admin_notes: string | null;
};

type OpsTab = "people" | "messaging" | "badge_ops" | "materials";

const OPS_TABS: Array<{ id: OpsTab; label: string }> = [
  { id: "people", label: "People Lookup" },
  { id: "messaging", label: "Messaging" },
  { id: "badge_ops", label: "Badge Ops" },
  { id: "materials", label: "Materials" },
];

const POLL_MS = 30_000;
const STALE_MS = POLL_MS * 2;

interface WarRoomClientProps {
  conferenceId: string;
  initialRows: ConferencePerson[];
  canEditAdminNotes: boolean;
}

export default function WarRoomClient({
  conferenceId,
  initialRows,
  canEditAdminNotes,
}: WarRoomClientProps) {
  const [rows, setRows] = useState<ConferencePerson[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personKind, setPersonKind] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [badgeStatus, setBadgeStatus] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(Date.now());
  const [activeOpsTab, setActiveOpsTab] = useState<OpsTab>("people");

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId]
  );
  const isStale = Date.now() - lastSuccessAt > STALE_MS;

  useEffect(() => {
    if (selected?.admin_notes !== undefined) {
      setNoteDraft(selected.admin_notes ?? "");
    }
  }, [selected?.id, selected?.admin_notes]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (personKind) params.set("person_kind", personKind);
    if (assignmentStatus) params.set("assignment_status", assignmentStatus);
    if (badgeStatus) params.set("badge_status", badgeStatus);
    if (checkIn) params.set("check_in", checkIn);
    const query = params.toString();
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/war-room${query ? `?${query}` : ""}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        rows?: ConferencePerson[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load data.");
      setRows(payload.rows ?? []);
      setError(null);
      setLastSuccessAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load war-room data.");
    } finally {
      setLoading(false);
    }
  }, [assignmentStatus, badgeStatus, checkIn, conferenceId, personKind, search]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const runPersonOp = async (
    personId: string,
    op: "update" | "manual_check_in" | "reprint_badge",
    patch?: Record<string, unknown>,
    reprintPayload?: {
      reprintReason: "damaged" | "lost" | "name_change" | "ops_override";
      reprintNote?: string | null;
    }
  ) => {
    const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op,
        patch,
        reprintReason: reprintPayload?.reprintReason,
        reprintNote: reprintPayload?.reprintNote ?? null,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operation failed.");
    await load();
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Operations</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {OPS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveOpsTab(tab.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                activeOpsTab === tab.id
                  ? "border-[#EE2A2E] bg-[#fff5f5] text-[#EE2A2E]"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeOpsTab === "people" ? (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold text-gray-900">Filters</h2>
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
              <p className="mt-1 text-sm text-amber-700">
                Data is stale. Refresh before applying manual actions.
              </p>
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
                        No rows found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="px-3 py-2 text-gray-900">
                          {row.display_name ?? row.contact_email ?? row.id}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.person_kind}</td>
                        <td className="px-3 py-2 text-gray-700">{row.assignment_status}</td>
                        <td className="px-3 py-2 text-gray-700">{row.badge_print_status}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {row.checked_in_at ? "Checked In" : "Not Checked In"}
                        </td>
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
              <p className="mt-1 text-sm text-gray-600">
                {selected.display_name ?? selected.contact_email ?? selected.id}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 p-3 text-sm">
                  <p className="font-medium text-gray-900">Travel / Hotel</p>
                  <p className="mt-1 text-gray-700">Mode: {selected.travel_mode ?? "—"}</p>
                  <p className="text-gray-700">Hotel: {selected.hotel_name ?? "—"}</p>
                  <p className="text-gray-700">
                    Confirmation: {selected.hotel_confirmation_code ?? "—"}
                  </p>
                  <p className="text-gray-700">
                    Dietary: {selected.dietary_restrictions ? "Flagged" : "None"}
                  </p>
                  <p className="text-gray-700">
                    Accessibility: {selected.accessibility_needs ? "Flagged" : "None"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 p-3 text-sm">
                  <p className="font-medium text-gray-900">Quick Actions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isStale}
                      onClick={() => void runPersonOp(selected.id, "manual_check_in")}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Manual Check-in
                    </button>
                    <button
                      type="button"
                      disabled={isStale}
                      onClick={() => {
                        const reasonRaw = window.prompt(
                          "Reprint reason (damaged, lost, name_change, ops_override):",
                          "damaged"
                        );
                        if (!reasonRaw) return;
                        const reason = reasonRaw.trim().toLowerCase();
                        if (!["damaged", "lost", "name_change", "ops_override"].includes(reason)) {
                          return;
                        }
                        const note = window.prompt("Optional reprint note:", "") ?? "";
                        void runPersonOp(selected.id, "reprint_badge", undefined, {
                          reprintReason: reason as
                            | "damaged"
                            | "lost"
                            | "name_change"
                            | "ops_override",
                          reprintNote: note.trim().length > 0 ? note.trim() : null,
                        });
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reprint Badge
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
                        onClick={() =>
                          void runPersonOp(selected.id, "update", { admin_notes: noteDraft })
                        }
                        className="mt-2 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save Notes
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-gray-600">
                      Admin notes are visible/editable only to admin and super admin users.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {activeOpsTab === "messaging" ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">During-Conference Messaging</h2>
          <p className="mt-2 text-sm text-gray-600">
            Messaging actions will live here (broadcast updates, issue alerts, and attendee support
            replies).
          </p>
        </section>
      ) : null}

      {activeOpsTab === "badge_ops" ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Badge Operations</h2>
          <p className="mt-2 text-sm text-gray-600">
            Badge print/reprint queue and status controls will be surfaced in this tab.
          </p>
          <a
            href={`/admin/conference/${conferenceId}/badges`}
            className="mt-3 inline-flex rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Open Badge Operations
          </a>
        </section>
      ) : null}

      {activeOpsTab === "materials" ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Educational Materials</h2>
          <p className="mt-2 text-sm text-gray-600">
            Material distribution tracking and pickup status will be managed here.
          </p>
        </section>
      ) : null}
    </div>
  );
}
