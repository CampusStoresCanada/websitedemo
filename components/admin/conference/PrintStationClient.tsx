"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listQueuedLabels, markLabelPrinted, type QueuedLabel } from "@/lib/actions/conference-badges";

/**
 * The print station: one page open on the laptop beside the QL, printing every
 * sticker a desk device sends it, oldest first, front then back.
 *
 * ⛔ The consumer `sent_to_printer` never had. The browser cannot pick a printer
 * itself, so the QL must be this laptop's DEFAULT printer; started with Chrome's
 * `--kiosk-printing` flag it prints with no dialog at all, otherwise each
 * sticker asks once.
 */
const POLL_MS = 4000;

export default function PrintStationClient({
  conferenceId,
  conferenceName,
}: {
  conferenceId: string;
  conferenceName: string;
}) {
  const [queue, setQueue] = useState<QueuedLabel[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  const [printed, setPrinted] = useState<Array<{ name: string; at: string }>>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const busyRef = useRef(false);
  // A job whose sticker cannot be drawn is skipped for this session rather than
  // holding up everyone behind it; it stays in the queue for someone to look at.
  const skippedRef = useRef(new Set<string>());

  const printSide = useCallback(
    async (jobId: string, side: "all" | "front" | "schedule" | "back") => {
      const url = `/api/admin/conference/${conferenceId}/badges/jobs/${jobId}/pdf?side=${side}`;
      const check = await fetch(url, { cache: "no-store" });
      if (!check.ok) {
        const body = (await check.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The ${side === "all" ? "" : `${side} `}stickers could not be drawn.`);
      }
      const frame = frameRef.current;
      if (!frame) throw new Error("The print frame is missing.");
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`The ${side} sticker took too long to load.`)), 15000);
        frame.onload = () => {
          window.clearTimeout(timer);
          // Let the fonts and logo settle before the sticker goes to the printer.
          window.setTimeout(() => {
            try {
              frame.contentWindow?.print();
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error("Printing failed."));
            }
          }, 500);
        };
        frame.src = url;
      });
    },
    [conferenceId]
  );

  const tick = useCallback(async () => {
    if (busyRef.current || paused) return;
    const res = await listQueuedLabels(conferenceId);
    if (!res.success) {
      setProblem(res.error);
      return;
    }
    setQueue(res.data);
    const next = res.data.find((job) => !skippedRef.current.has(job.jobId));
    if (!next) return;
    busyRef.current = true;
    setPrinting(next.personName || "someone");
    try {
      // ⛔ ONE print job: every sticker in order (front, schedule on a spare,
      // QR), each at its own length — Chrome honours the named pages.
      await printSide(next.jobId, "all");
      const done = await markLabelPrinted({ conferenceId, jobId: next.jobId });
      if (!done.success) throw new Error(done.error);
      setPrinted((prev) => [{ name: next.personName, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      setProblem(null);
    } catch (error) {
      skippedRef.current.add(next.jobId);
      setProblem(`${next.personName || "A sticker"}: ${error instanceof Error ? error.message : "could not print."}`);
    } finally {
      busyRef.current = false;
      setPrinting(null);
    }
  }, [conferenceId, paused, printSide]);

  useEffect(() => {
    const id = window.setInterval(() => void tick(), POLL_MS);
    const first = window.setTimeout(() => void tick(), 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, [tick]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 text-gray-900">
      <h1 className="text-2xl font-bold">Print station</h1>
      <p className="text-sm text-gray-600">{conferenceName}</p>

      <div className="mt-6 rounded-xl border border-gray-200 p-5">
        <p className="text-lg font-semibold">
          {paused ? "Paused" : printing ? `Printing ${printing}…` : queue.length ? `${queue.length} waiting` : "Waiting for stickers"}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Any desk device can send stickers here with “Send to print queue”. Each one prints as a single job: front, schedule (spare cards only), then the QR, cut apart by the printer.
        </p>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="mt-4 min-h-12 rounded-lg border border-gray-300 px-5 text-base font-medium"
        >
          {paused ? "Resume printing" : "Pause (changing the roll)"}
        </button>
        {problem ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{problem}</p> : null}
      </div>

      {queue.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Waiting</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {queue.map((job) => (
              <li key={job.jobId} className="flex justify-between px-4 py-2 text-sm">
                <span>{job.personName || "Unnamed"}</span>
                {skippedRef.current.has(job.jobId) ? <span className="text-red-600">skipped</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {printed.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Printed</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {printed.map((row, i) => (
              <li key={i} className="flex justify-between px-4 py-2 text-sm">
                <span>{row.name || "Unnamed"}</span>
                <span className="text-gray-500">{row.at}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-semibold">Setting up this laptop</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Install the Brother QL-1110NWB driver and make the QL the default printer, with the 62 mm roll.</li>
          <li>Keep this page open. Leave the laptop awake and plugged in.</li>
          <li>For no print dialog at all, start Chrome with <code>--kiosk-printing</code>. Otherwise press Print once per sticker.</li>
        </ol>
      </section>

      {/* The sticker is drawn here, off screen, then sent to the printer. */}
      <iframe ref={frameRef} title="Sticker" className="pointer-events-none fixed -left-[9999px] top-0 h-[400px] w-[400px]" />
    </main>
  );
}
