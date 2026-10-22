"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPrintStation,
  listPrintStations,
  listQueuedLabels,
  revokePrintStation,
  type PrintStationRow,
  type QueuedLabel,
} from "@/lib/actions/conference-badges";

/**
 * The desk's print stations: the laptops that print the sticker queue.
 *
 * ⛔ This page does not print. A browser's print dialog lets the printer
 * driver override each sticker's size with its own paper (a 120 mm back came
 * out as two 100 mm pieces, 2026-10-21), so printing happens in CSC Print
 * Station on the laptop, straight to the QL. Here you add that laptop (its
 * key), see whether it is online and what the printer says, and what is
 * waiting.
 */
const POLL_MS = 5000;

export default function PrintStationClient({
  conferenceId,
  conferenceName,
}: {
  conferenceId: string;
  conferenceName: string;
}) {
  const [stations, setStations] = useState<PrintStationRow[] | null>(null);
  const [queue, setQueue] = useState<QueuedLabel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, q] = await Promise.all([listPrintStations(conferenceId), listQueuedLabels(conferenceId)]);
    if (s.success) setStations(s.data);
    else setError(s.error);
    if (q.success) setQueue(q.data);
  }, [conferenceId]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await createPrintStation({ conferenceId, label: label || "Print station" });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setNewKey(res.data.key);
    setLabel("");
    void refresh();
  };

  const revoke = async (station: PrintStationRow) => {
    if (!window.confirm(`Stop "${station.label}" printing? Its key stops working at once.`)) return;
    const res = await revokePrintStation({ conferenceId, stationId: station.id });
    if (!res.success) setError(res.error);
    void refresh();
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 text-gray-900">
      <h1 className="text-2xl font-bold">Print stations</h1>
      <p className="text-sm text-gray-600">{conferenceName}</p>
      <p className="mt-3 text-sm text-gray-700">
        Stickers print on a laptop beside the Brother QL running <strong>CSC Print Station</strong>, straight to the
        printer, each at its exact length. Any desk device sends to it with “Send to print queue”.
      </p>
      {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Stations</h2>
        {stations === null ? (
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        ) : stations.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">None yet. Add the laptop beside the printer below.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {stations.map((station) => (
              <li key={station.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className={station.online ? "text-emerald-600" : "text-gray-400"}>●</span> {station.label}{" "}
                    <span className="font-normal text-gray-500">{station.online ? "online" : "offline"}</span>
                  </p>
                  {station.printerStatus || station.printerMedia ? (
                    <p className={`text-xs ${station.printerStatus && station.printerStatus !== "ready" ? "text-red-600" : "text-gray-500"}`}>
                      Printer: {station.printerStatus ?? "unknown"}
                      {station.printerMedia ? ` · ${station.printerMedia}` : ""}
                    </p>
                  ) : null}
                </div>
                <button type="button" onClick={() => void revoke(station)} className="shrink-0 text-xs font-medium text-red-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold">Add this laptop</h2>
        {newKey ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-gray-700">
              Its key, shown <strong>once</strong>. Paste it when CSC Print Station asks. Lost it? Remove the station
              and add it again.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded bg-gray-100 px-3 py-2 text-sm">{newKey}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(newKey)}
                className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm"
              >
                Copy
              </button>
            </div>
            <button type="button" onClick={() => setNewKey(null)} className="text-sm text-gray-600 underline">
              Done
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Registration desk laptop"
              className="min-h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void add()}
              className="min-h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Get a key"}
            </button>
          </div>
        )}
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>Plug the Brother QL into the laptop by USB, with the 62 mm continuous roll loaded.</li>
          <li>Open <strong>CSC Print Station</strong> and paste the key.</li>
          <li>Leave it running, plugged in and awake. It shows online here within a few seconds.</li>
        </ol>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Waiting to print</h2>
        {queue.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing waiting.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {queue.map((job) => (
              <li key={job.jobId} className="px-4 py-2 text-sm">
                {job.documentTitle ? (
                  <>
                    {job.documentTitle} <span className="text-gray-500">· document, on the paper printer</span>
                  </>
                ) : (
                  <>
                    {job.personName || "Unnamed"} <span className="text-gray-500">· {job.stickers.length} stickers</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
