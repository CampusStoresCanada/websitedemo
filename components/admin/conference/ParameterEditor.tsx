"use client";

import { useState } from "react";
import { upsertConferenceParameters } from "@/lib/actions/conference";
import type { Database } from "@/lib/database.types";

type ParamsRow = Database["public"]["Tables"]["conference_parameters"]["Row"];

interface ParameterEditorProps {
  conferenceId: string;
  params: ParamsRow | null;
}

export default function ParameterEditor({ conferenceId, params }: ParameterEditorProps) {
  const [conferenceDays, setConferenceDays] = useState(params?.conference_days ?? 3);
  const [slotsPerDay, setSlotsPerDay] = useState(params?.meeting_slots_per_day ?? 12);
  const [slotDuration, setSlotDuration] = useState(params?.slot_duration_minutes ?? 15);
  const [slotBuffer, setSlotBuffer] = useState(params?.slot_buffer_minutes ?? 0);
  const [meetingStart, setMeetingStart] = useState(params?.meeting_start_time ?? "09:00");
  const [meetingEnd, setMeetingEnd] = useState(params?.meeting_end_time ?? "14:05");
  const [flexStart, setFlexStart] = useState(params?.flex_time_start ?? "");
  const [flexEnd, setFlexEnd] = useState(params?.flex_time_end ?? "");
  const [totalSuites, setTotalSuites] = useState(params?.total_meeting_suites ?? 45);
  const [targetMeetings, setTargetMeetings] = useState(params?.delegate_target_meetings ?? 0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    const result = await upsertConferenceParameters(conferenceId, {
      conference_days: conferenceDays,
      meeting_slots_per_day: slotsPerDay,
      slot_duration_minutes: slotDuration,
      slot_buffer_minutes: slotBuffer,
      meeting_start_time: meetingStart,
      meeting_end_time: meetingEnd,
      flex_time_start: flexStart || null,
      flex_time_end: flexEnd || null,
      total_meeting_suites: totalSuites,
      delegate_target_meetings: targetMeetings || null,
    });

    setIsLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
    } else {
      setSuccess(true);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          Parameters saved successfully.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Conference Days</label>
          <input type="number" min={1} required value={conferenceDays} onChange={(e) => setConferenceDays(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slots / Day</label>
          <input type="number" min={1} required value={slotsPerDay} onChange={(e) => setSlotsPerDay(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slot Duration (min)</label>
          <input type="number" min={5} required value={slotDuration} onChange={(e) => setSlotDuration(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Buffer Between (min)</label>
          <input type="number" min={0} required value={slotBuffer} onChange={(e) => setSlotBuffer(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Start</label>
          <input type="time" required value={meetingStart} onChange={(e) => setMeetingStart(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Meeting End</label>
          <input type="time" required value={meetingEnd} onChange={(e) => setMeetingEnd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Flex Time Start</label>
          <input type="time" value={flexStart} onChange={(e) => setFlexStart(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Flex Time End</label>
          <input type="time" value={flexEnd} onChange={(e) => setFlexEnd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Total Meeting Suites</label>
          <input type="number" min={1} required value={totalSuites} onChange={(e) => setTotalSuites(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Delegate Target Meetings</label>
          <input type="number" min={0} value={targetMeetings} onChange={(e) => setTargetMeetings(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D60001]" />
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="px-6 py-2 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50"
      >
        {isLoading ? "Saving..." : "Save Parameters"}
      </button>
    </form>
  );
}
