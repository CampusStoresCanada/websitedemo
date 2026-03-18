"use client";

import { useState, useTransition } from "react";
import { adminRegisterUser, getEligibleMembersForEvent } from "@/lib/actions/event-registration";
import type { AttendeeRow } from "@/lib/events/types";

type EligibleMember = { user_id: string; display_name: string | null; email: string | null; org_name: string | null };

interface AttendeeListProps {
  attendees: AttendeeRow[];
  eventId: string;
}

function exportCsv(attendees: AttendeeRow[], eventId: string) {
  const headers = ["Name", "Email", "Status", "Registered At", "Checked In", "Checked In At"];
  const rows = attendees.map((a) => [
    a.display_name ?? "",
    a.email ?? "",
    a.registration_status,
    new Date(a.registered_at).toLocaleString("en-CA"),
    a.checked_in ? "Yes" : "No",
    a.checked_in_at ? new Date(a.checked_in_at).toLocaleString("en-CA") : "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendees-${eventId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendeeList({ attendees, eventId }: AttendeeListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [members, setMembers] = useState<EligibleMember[] | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<EligibleMember | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isPending, startTransition] = useTransition();

  const filtered = attendees.filter((a) => {
    const matchesSearch =
      !search ||
      (a.display_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || a.registration_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const checkedInCount = attendees.filter((a) => a.checked_in).length;

  async function openPicker() {
    setAddOpen(true);
    setAddError(null);
    setAddSuccess(false);
    setSelectedMember(null);
    setMemberSearch("");
    if (!members) {
      setIsLoadingMembers(true);
      const result = await getEligibleMembersForEvent(eventId);
      setIsLoadingMembers(false);
      if (result.success) setMembers(result.data);
      else setAddError(result.error);
    }
  }

  function closePicker() {
    setAddOpen(false);
    setSelectedMember(null);
    setMemberSearch("");
    setAddError(null);
  }

  function handleConfirmAdd() {
    if (!selectedMember) return;
    setAddError(null);
    startTransition(async () => {
      const result = await adminRegisterUser(eventId, selectedMember.user_id);
      if (result.success) {
        setAddSuccess(true);
        setMembers((prev) => prev ? prev.filter((m) => m.user_id !== selectedMember.user_id) : null);
        setSelectedMember(null);
        setMemberSearch("");
      } else {
        setAddError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-gray-500">
          <span>
            <strong className="text-gray-900">{attendees.length}</strong> registered
          </span>
          <span>
            <strong className="text-gray-900">{checkedInCount}</strong> checked in
          </span>
        </div>
        <button
          onClick={openPicker}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Attendee
        </button>
      </div>

      {addSuccess && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          Attendee added as complimentary. Refresh the page to see them in the list.
        </div>
      )}

      {/* Member picker */}
      {addOpen && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              {selectedMember ? `Register ${selectedMember.display_name ?? selectedMember.email ?? "member"}` : "Select a member to register"}
            </p>
            <button onClick={closePicker} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {selectedMember ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-white border border-gray-200 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{selectedMember.display_name ?? "—"}</p>
                <p className="text-xs text-gray-500">{selectedMember.email ?? "—"}</p>
                {selectedMember.org_name && (
                  <p className="text-xs text-gray-400 mt-0.5">{selectedMember.org_name}</p>
                )}
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                This registration will be marked <strong>complimentary</strong> — no payment collected.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmAdd}
                  disabled={isPending}
                  className="flex-1 px-4 py-2 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  {isPending ? "Adding…" : "Confirm — Add as Complimentary"}
                </button>
                <button
                  onClick={() => { setSelectedMember(null); setAddError(null); }}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search by name or email…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
                autoFocus
              />
              {isLoadingMembers ? (
                <p className="text-sm text-gray-400 py-4 text-center">Loading members…</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {(members ?? [])
                    .filter((m) =>
                      !memberSearch ||
                      (m.display_name ?? "").toLowerCase().includes(memberSearch.toLowerCase()) ||
                      (m.email ?? "").toLowerCase().includes(memberSearch.toLowerCase())
                    )
                    .slice(0, 30)
                    .map((m) => (
                      <button
                        key={m.user_id}
                        onClick={() => setSelectedMember(m)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-gray-900">{m.display_name ?? <span className="text-gray-400 italic">No name</span>}</p>
                        <p className="text-xs text-gray-500">{m.email ?? "—"}{m.org_name ? ` · ${m.org_name}` : ""}</p>
                      </button>
                    ))}
                  {(members ?? []).length === 0 && !isLoadingMembers && (
                    <p className="text-sm text-gray-400 py-4 text-center">No eligible members found.</p>
                  )}
                </div>
              )}
              {addError && <p className="text-sm text-red-600">{addError}</p>}
            </>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
        >
          <option value="">All statuses</option>
          <option value="registered">Registered</option>
          <option value="promoted">Promoted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          onClick={() => exportCsv(filtered, eventId)}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No attendees found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Registered</th>
                <th className="px-4 py-3 text-left font-medium">Checked In</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((attendee) => (
                <tr key={attendee.registration_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {attendee.display_name ?? <span className="text-gray-400 italic">Unknown</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{attendee.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                        attendee.registration_status === "registered"
                          ? "bg-green-100 text-green-700"
                          : attendee.registration_status === "promoted"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {attendee.registration_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(attendee.registered_at).toLocaleDateString("en-CA")}
                  </td>
                  <td className="px-4 py-3">
                    {attendee.checked_in ? (
                      <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {attendee.checked_in_at
                          ? new Date(attendee.checked_in_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })
                          : "Yes"}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
