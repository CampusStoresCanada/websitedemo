"use client";

import { useEffect, useState, type ReactNode } from "react";
import { listPrintStations } from "@/lib/actions/conference-badges";

/** One piece of the status line: a fact, coloured by how much it matters, linking to where you fix it. */
export function StatusItem({ tone, href, children }: { tone: "alert" | "warn" | "ok" | "quiet"; href: string; children: ReactNode }) {
  const dot =
    tone === "alert" ? "bg-red-600" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-green-600" : "bg-gray-300";
  return (
    <a href={href} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700 hover:text-gray-950">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </a>
  );
}

/**
 * The print station's piece, re-checked every 15 seconds. ⛔ Rendered once,
 * it said "online" for three hours after the station stopped (2026-11-06).
 */
export function StationStatusItem({
  conferenceId,
  stations: initialStations,
  online: initialOnline,
  queued,
}: {
  conferenceId: string;
  stations: number;
  online: boolean;
  queued: number;
}) {
  const [{ stations, online }, setState] = useState({ stations: initialStations, online: initialOnline });
  useEffect(() => {
    let live = true;
    const id = window.setInterval(() => {
      void listPrintStations(conferenceId).then((res) => {
        if (live && res.success) setState({ stations: res.data.length, online: res.data.some((s) => s.online) });
      });
    }, 15_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [conferenceId]);
  return (
    // The station's own page: setup, its key and the app download.
    <StatusItem tone={stations === 0 ? "quiet" : online ? "ok" : "alert"} href={`/admin/conference/${conferenceId}/check-in/print-station`}>
      {stations === 0 ? "No print station" : online ? "Print station online" : "Print station offline"}
      {queued ? ` · ${queued} waiting` : ""}
    </StatusItem>
  );
}
