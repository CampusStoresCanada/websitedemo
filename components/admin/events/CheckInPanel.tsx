"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkIn, undoCheckIn } from "@/lib/actions/event-checkin";
import type { AttendeeRow } from "@/lib/events/types";

interface CheckInPanelProps {
  eventId: string;
  attendees: AttendeeRow[];
}

export default function CheckInPanel({ eventId, attendees }: CheckInPanelProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ userId: string; message: string; ok: boolean } | null>(null);

  const filtered = search
    ? attendees.filter(
        (a) =>
          (a.display_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (a.email ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : attendees;

  const checkedInCount = attendees.filter((a) => a.checked_in).length;

  const handleToggle = (attendee: AttendeeRow) => {
    setActioningId(attendee.user_id);
    setFlash(null);

    startTransition(async () => {
      const action = attendee.checked_in
        ? undoCheckIn(eventId, attendee.user_id)
        : checkIn(eventId, attendee.user_id);

      const result = await action;
      setActioningId(null);

      if (result.success) {
        setFlash({
          userId: attendee.user_id,
          message: attendee.checked_in
            ? `Check-in undone for ${attendee.display_name ?? "attendee"}`
            : `${attendee.display_name ?? "Attendee"} checked in`,
          ok: true,
        });
        router.refresh();
      } else {
        setFlash({
          userId: attendee.user_id,
          message: result.error,
          ok: false,
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          <strong className="text-gray-900 text-lg">{checkedInCount}</strong>
          <span className="text-gray-400"> / {attendees.length} checked in</span>
        </div>
        {attendees.length > 0 && (
          <div className="w-48 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(checkedInCount / attendees.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Flash message */}
      {flash && (
        <div
          className={`text-sm px-3 py-2 rounded-lg ${
            flash.ok
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {flash.message}
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        autoFocus
      />

      {/* Attendee rows */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          {search ? "No matching attendees" : "No registered attendees yet"}
        </p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
          {filtered.map((attendee) => {
            const isActioning = isPending && actioningId === attendee.user_id;

            return (
              <div
                key={attendee.user_id}
                className={`flex items-center justify-between px-4 py-3 transition-colors ${
                  attendee.checked_in ? "bg-green-50" : "bg-white hover:bg-gray-50"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {attendee.display_name ?? <span className="text-gray-400 italic">Unknown</span>}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{attendee.email}</p>
                </div>

                <button
                  onClick={() => handleToggle(attendee)}
                  disabled={isActioning}
                  className={`ml-4 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    attendee.checked_in
                      ? "bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-700"
                      : "bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700"
                  }`}
                >
                  {isActioning ? (
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : attendee.checked_in ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Checked in
                    </>
                  ) : (
                    "Check in"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
