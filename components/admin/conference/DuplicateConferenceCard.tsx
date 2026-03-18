"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { duplicateConference } from "@/lib/actions/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];

interface DuplicateConferenceCardProps {
  conferences: ConferenceRow[];
}

export default function DuplicateConferenceCard({ conferences }: DuplicateConferenceCardProps) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(conferences[0]?.id ?? "");
  const [newYear, setNewYear] = useState(new Date().getFullYear() + 1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConference = useMemo(
    () => conferences.find((conference) => conference.id === sourceId) ?? null,
    [conferences, sourceId]
  );

  if (conferences.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Duplicate From Previous</h2>
      <p className="text-sm text-gray-500 mb-3">
        Create next year&apos;s draft from an existing conference template.
      </p>
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Source conference</span>
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="min-w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {conferences.map((conference) => (
              <option key={conference.id} value={conference.id}>
                {conference.name} ({conference.year})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">New year</span>
          <input
            type="number"
            value={newYear}
            onChange={(event) => setNewYear(parseInt(event.target.value, 10))}
            className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          type="button"
          disabled={isLoading || !selectedConference}
          onClick={async () => {
            if (!selectedConference) return;
            setIsLoading(true);
            setError(null);
            const result = await duplicateConference(selectedConference.id, newYear);
            setIsLoading(false);
            if (result.success && result.data) {
              router.push(`/admin/conference/${result.data.id}`);
            } else {
              setError(result.error ?? "Failed to duplicate conference");
            }
          }}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
        >
          {isLoading ? "Duplicating..." : "Duplicate"}
        </button>
      </div>
    </div>
  );
}
