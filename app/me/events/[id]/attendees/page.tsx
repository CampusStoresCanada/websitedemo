"use client";

import { useState, useEffect, useTransition } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAttendeesForCreator } from "@/lib/actions/event-registration";

type AttendeeRow = {
  user_id: string;
  display_name: string | null;
  registration_status: string;
  registered_at: string;
  checked_in: boolean;
  checked_in_at: string | null;
};

function parseUTC(s: string) {
  const utc = s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z";
  return new Date(utc);
}

function exportCsv(rows: AttendeeRow[], eventId: string) {
  const headers = ["Name", "Status", "Registered At", "Checked In"];
  const data = rows.map((r) => [
    r.display_name ?? "",
    r.registration_status,
    parseUTC(r.registered_at).toLocaleString("en-CA"),
    r.checked_in ? (r.checked_in_at ? parseUTC(r.checked_in_at).toLocaleString("en-CA") : "Yes") : "No",
  ]);
  const csv = [headers, ...data].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendees-${eventId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const statusColor: Record<string, string> = {
  registered: "bg-green-100 text-green-700",
  promoted:   "bg-blue-100 text-blue-700",
  cancelled:  "bg-red-100 text-red-700",
};

export default function HostAttendeesPage() {
  const { id } = useParams<{ id: string }>();
  const [attendees, setAttendees] = useState<AttendeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await getAttendeesForCreator(id);
      if (result.success) setAttendees(result.data);
      else setError(result.error);
    });
  }, [id]);

  const filtered = (attendees ?? []).filter((a) =>
    !search || (a.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/me" className="text-sm text-gray-500 hover:text-gray-700">My Account</Link>
            <span className="text-gray-300">/</span>
            <Link href="/me/events" className="text-sm text-gray-500 hover:text-gray-700">My Events</Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-900 font-medium">Attendees</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Attendees</h1>
        </div>
        {attendees && attendees.length > 0 && (
          <button
            onClick={() => exportCsv(filtered, id)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
      )}

      {isPending && !attendees && (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      )}

      {attendees !== null && (
        <>
          {/* Stats */}
          <div className="flex gap-4 text-sm text-gray-500">
            <span><strong className="text-gray-900">{attendees.filter((a) => a.registration_status !== "cancelled").length}</strong> registered</span>
            <span><strong className="text-gray-900">{attendees.filter((a) => a.checked_in).length}</strong> checked in</span>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
          />

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No attendees yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Registered</th>
                    <th className="px-4 py-3 text-left font-medium">Checked In</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((a) => (
                    <tr key={a.user_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {a.display_name ?? <span className="text-gray-400 italic">Member</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[a.registration_status] ?? "bg-gray-100 text-gray-500"}`}>
                          {a.registration_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {parseUTC(a.registered_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        {a.checked_in ? (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            {a.checked_in_at
                              ? parseUTC(a.checked_in_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })
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
        </>
      )}
    </main>
  );
}
