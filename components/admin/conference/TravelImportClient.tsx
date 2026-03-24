"use client";

import { useState } from "react";
import {
  runTravelImportCsv,
  type TravelImportConflictMode,
  type TravelImportReport,
} from "@/lib/actions/conference-registration";

type TravelImportClientProps = {
  conferenceId: string;
};

const DEFAULT_CSV = [
  "conference_id,registration_id,user_id,travel_mode,arrival_flight_number,arrival_datetime,arrival_airport,departure_flight_number,departure_datetime,departure_airport,lodging_property,room_number,hotel_confirmation_number,travel_confirmation_reference,admin_note",
  "",
].join("\n");

export default function TravelImportClient({ conferenceId }: TravelImportClientProps) {
  const [csvContent, setCsvContent] = useState(DEFAULT_CSV);
  const [conflictMode, setConflictMode] = useState<TravelImportConflictMode>("fill_empty_only");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TravelImportReport | null>(null);

  async function execute(dryRun: boolean) {
    setIsRunning(true);
    setError(null);
    try {
      const result = await runTravelImportCsv({
        conferenceId,
        csvContent,
        conflictMode,
        dryRun,
      });
      if (!result.success || !result.data) {
        setError(result.error ?? "Travel import failed.");
        return;
      }
      setReport(result.data);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm text-gray-700">
          Conflict mode
          <select
            value={conflictMode}
            onChange={(event) => setConflictMode(event.target.value as TravelImportConflictMode)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          >
            <option value="fill_empty_only">fill_empty_only</option>
            <option value="overwrite">overwrite</option>
            <option value="skip_if_existing">skip_if_existing</option>
          </select>
        </label>
      </div>

      <label className="block text-sm text-gray-700">
        CSV payload
        <textarea
          value={csvContent}
          onChange={(event) => setCsvContent(event.target.value)}
          rows={14}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void execute(true)}
          disabled={isRunning}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {isRunning ? "Running..." : "Dry Run"}
        </button>
        <button
          type="button"
          onClick={() => void execute(false)}
          disabled={isRunning}
          className="rounded-md bg-[#EE2A2E] px-3 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
        >
          {isRunning ? "Applying..." : "Apply Import"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {report ? (
        <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="grid gap-2 text-xs text-gray-700 md:grid-cols-3">
            <p>
              <span className="font-semibold">Mode:</span> {report.conflictMode}
            </p>
            <p>
              <span className="font-semibold">Run type:</span> {report.dryRun ? "dry_run" : "apply"}
            </p>
            <p>
              <span className="font-semibold">Duplicate:</span>{" "}
              {report.duplicateSubmission ? "yes (no-op)" : "no"}
            </p>
            <p>
              <span className="font-semibold">Success:</span> {report.totals.success}
            </p>
            <p>
              <span className="font-semibold">Failed:</span> {report.totals.failed}
            </p>
            <p>
              <span className="font-semibold">Skipped:</span> {report.totals.skipped}
            </p>
          </div>
          <p className="text-xs text-gray-600">
            idempotency key: <span className="font-mono">{report.idempotencyKey}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-white">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700">Row</th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700">Code</th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700">Registration</th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {report.rows.map((row) => (
                  <tr key={row.rowRef}>
                    <td className="px-2 py-1 text-gray-700">{row.rowRef}</td>
                    <td className="px-2 py-1 text-gray-700">{row.status}</td>
                    <td className="px-2 py-1 text-gray-700">{row.code ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-gray-700">
                      {row.registrationId ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-gray-700">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
