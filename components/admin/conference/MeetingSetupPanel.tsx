"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMeetingDayCadence,
  syncSuiteCount,
  type MeetingSetup,
  type MeetingDaySetup,
  type SuiteLocation,
} from "@/lib/actions/conference-entities";

const inputClass =
  "rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent";

export default function MeetingSetupPanel({
  conferenceId,
  initial,
}: {
  conferenceId: string;
  initial: MeetingSetup;
}) {
  const router = useRouter();
  const [days, setDays] = useState<MeetingDaySetup[]>(initial.days);
  const [suiteCount, setSuiteCount] = useState(String(initial.suiteCount));
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingPending, startSync] = useTransition();

  const updateDay = (id: string, patch: Partial<MeetingDaySetup>) =>
    setDays(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));

  const saveDay = async (day: MeetingDaySetup) => {
    setError(null);
    setSavingId(day.id);
    const res = await saveMeetingDayCadence(day.id, {
      isMeetingDay: day.isMeetingDay,
      meetingStartTime: day.meetingStartTime,
      meetingEndTime: day.meetingEndTime,
      slotDurationMinutes: day.slotDurationMinutes,
      bufferMinutes: day.bufferMinutes,
    });
    setSavingId(null);
    if (!res.success) setError(res.error);
    else router.refresh();
  };

  const handleSuiteSync = () => {
    setError(null);
    const n = Math.max(0, parseInt(suiteCount) || 0);
    startSync(async () => {
      const res = await syncSuiteCount(conferenceId, n);
      if (!res.success) setError(res.error);
      else { setSuiteCount(String(res.data.suiteCount)); router.refresh(); }
    });
  };

  const meetingDayCount = days.filter(d => d.isMeetingDay).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Meeting setup</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Configure which days have meetings and how long each slot is. The scheduler reads this
          directly — no separate parameters form needed.
        </p>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-gray-100">
        {days.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            No days defined yet. Sync days from the conference dates in the{" "}
            <strong>Days & Setup</strong> tab first.
          </p>
        ) : (
          days.map(day => (
            <DayRow
              key={day.id}
              day={day}
              saving={savingId === day.id}
              onChange={patch => updateDay(day.id, patch)}
              onSave={() => saveDay(day)}
            />
          ))
        )}
      </div>

      {/* Suite count */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Meeting suites</label>
          <input
            type="number"
            min={0}
            max={200}
            value={suiteCount}
            onChange={e => setSuiteCount(e.target.value)}
            className={`${inputClass} w-20`}
          />
        </div>
        <button
          type="button"
          disabled={syncingPending}
          onClick={handleSuiteSync}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {syncingPending ? "Syncing…" : "Sync suites"}
        </button>
        <p className="text-xs text-gray-400">
          Currently {initial.suiteCount} suite{initial.suiteCount !== 1 ? "s" : ""} in catalog.
          Sync stamps or removes to match the number above.
        </p>
      </div>

      {/* Suite locations */}
      {initial.suiteLocations.length > 0 ? (
        <SuiteLocationTable locations={initial.suiteLocations} />
      ) : null}

      {/* Summary */}
      {meetingDayCount > 0 ? (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 rounded-b-xl">
          {meetingDayCount} meeting day{meetingDayCount !== 1 ? "s" : ""} ·{" "}
          {initial.suiteCount} suite{initial.suiteCount !== 1 ? "s" : ""} ·{" "}
          Slots generated automatically from time window + slot duration.
        </div>
      ) : null}
    </div>
  );
}

function SuiteLocationTable({ locations }: { locations: SuiteLocation[] }) {
  const withLocation = locations.filter(l => l.locationName);
  const without = locations.filter(l => !l.locationName);

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-medium text-gray-500">Suite locations</p>
        <p className="text-[10px] text-gray-400">
          Set via a <code className="bg-gray-100 px-0.5 rounded">where</code> connection on the suite,
          or inherited from whichever entity includes it.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        {withLocation.map(l => (
          <div key={l.suiteId} className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium text-gray-700 tabular-nums w-8 shrink-0">{l.suiteName}</span>
            <span className="text-gray-300">→</span>
            <span className="truncate text-gray-600">{l.locationName}</span>
            {l.locationSource === "booth" && (
              <span className="shrink-0 text-[9px] text-gray-300">(booth)</span>
            )}
          </div>
        ))}
      </div>
      {without.length > 0 && (
        <p className="mt-1.5 text-[10px] text-gray-400">
          {without.length} suite{without.length !== 1 ? "s" : ""} have no location set:{" "}
          {without.map(l => l.suiteName).slice(0, 5).join(", ")}
          {without.length > 5 ? ` +${without.length - 5} more` : ""}.
          Connect them to a venue or booth in the Catalog to assign a location.
        </p>
      )}
    </div>
  );
}

function DayRow({
  day,
  saving,
  onChange,
  onSave,
}: {
  day: MeetingDaySetup;
  saving: boolean;
  onChange: (patch: Partial<MeetingDaySetup>) => void;
  onSave: () => void;
}) {
  const slotsPerWindow =
    day.isMeetingDay && day.meetingStartTime && day.meetingEndTime
      ? (() => {
          const [sh, sm] = day.meetingStartTime.split(":").map(Number);
          const [eh, em] = day.meetingEndTime.split(":").map(Number);
          const windowMins = (eh * 60 + em) - (sh * 60 + sm);
          const slotSpan = day.slotDurationMinutes + day.bufferMinutes;
          return slotSpan > 0 ? Math.max(0, Math.floor((windowMins + day.bufferMinutes) / slotSpan)) : 0;
        })()
      : null;

  return (
    <div className={`px-4 py-3 ${day.isMeetingDay ? "" : "bg-gray-50/50"}`}>
      <div className="flex flex-wrap items-start gap-3">
        {/* toggle */}
        <label className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={day.isMeetingDay}
            onChange={e => onChange({ isMeetingDay: e.target.checked })}
          />
          <span className="w-28 text-sm font-medium text-gray-900 shrink-0">{day.label}</span>
        </label>

        {day.isMeetingDay ? (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Start</span>
              <input
                type="time"
                value={day.meetingStartTime}
                onChange={e => onChange({ meetingStartTime: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">End</span>
              <input
                type="time"
                value={day.meetingEndTime}
                onChange={e => onChange({ meetingEndTime: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Slot (min)</span>
              <input
                type="number"
                min={5}
                max={120}
                value={day.slotDurationMinutes}
                onChange={e => onChange({ slotDurationMinutes: parseInt(e.target.value) || 30 })}
                className={`${inputClass} w-16`}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Buffer (min)</span>
              <input
                type="number"
                min={0}
                max={60}
                value={day.bufferMinutes}
                onChange={e => onChange({ bufferMinutes: parseInt(e.target.value) || 0 })}
                className={`${inputClass} w-16`}
              />
            </label>
            <div className="flex flex-col gap-0.5 pt-1">
              {slotsPerWindow !== null ? (
                <span className="text-[11px] text-gray-500">
                  → <strong>{slotsPerWindow}</strong> slots/suite
                </span>
              ) : null}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="mt-0.5 self-end rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-gray-400 italic">Not a meeting day</span>
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Clear"}
            </button>
          </div>
        )}
      </div>

      {/* Blocked periods from meals */}
      {day.isMeetingDay && day.blockedPeriods.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
          <span className="text-[10px] text-gray-400">Auto-blocked:</span>
          {day.blockedPeriods.map(bp => (
            <span key={bp.name}
              className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-700">
              {bp.name.replace(/ - .*/, "")}: {bp.start}–{bp.end}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
