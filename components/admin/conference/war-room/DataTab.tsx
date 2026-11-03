"use client";

import { useState } from "react";
import { exportConferenceRoster, type RosterExport } from "@/lib/actions/conference-people";
import OperateRow from "@/components/ui/OperateRow";

import { plural } from "./shared";

/** How many people each Data export holds, from the live roster. */
export type WarRoomDataCounts = { attending: number; dietary: number; accessibility: number; emergency: number };

/** Hand a file the server built to the browser to save. */
function saveFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Data (WAR_ROOM_OPERATE_PLAN §5): files of the live roster. No travel import:
 * none until a conference collects travel (Stephen, 2026-10-26).
 */
export function DataView({
  conferenceId,
  counts,
  canExport,
}: {
  conferenceId: string;
  counts: WarRoomDataCounts;
  /** Members' personal data leaves the site only with a super admin. */
  canExport: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<RosterExport | null>(null);

  const download = async (kind: RosterExport) => {
    setBusy(kind);
    setError(null);
    const res = await exportConferenceRoster(conferenceId, kind);
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return res;
    }
    saveFile(res.data.filename, res.data.csv);
    return { success: true };
  };
  const button = (kind: RosterExport) =>
    !canExport ? (
      <span className="py-1.5 text-xs text-gray-500">Only a super admin can download this.</span>
    ) : (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => void download(kind)}
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {busy === kind ? "Preparing…" : "Download CSV"}
    </button>
  );
  const people = `/admin/conference/${conferenceId}/war-room?tab=people`;

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Exports</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Everyone attending"
            state={`${plural(counts.attending, "person")}: name, organization, email, mobile, checked in.`}
            extra={button("summary")}
          />
          <OperateRow
            title="Dietary needs"
            state={`${plural(counts.dietary, "person")} with dietary needs, for the caterer.`}
            edit={{ href: people, label: "People" }}
            extra={counts.dietary > 0 ? button("dietary") : null}
          />
          <OperateRow
            title="Accessibility needs"
            state={`${plural(counts.accessibility, "person")} with accessibility needs.`}
            edit={{ href: people, label: "People" }}
            extra={counts.accessibility > 0 ? button("accessibility") : null}
          />
          <OperateRow
            title="Emergency contacts"
            state={`${plural(counts.emergency, "person")} gave an emergency contact.`}
            extra={canExport ? null : button("emergency")}
            action={
              counts.emergency > 0 && canExport
                ? {
                    label: "Download CSV",
                    consequence: `Saves a file of ${plural(counts.emergency, "person")}'s emergency contacts and phone numbers to this computer. Keep it off shared drives, and delete it after the conference.`,
                    onConfirm: () => download("emergency"),
                  }
                : null
            }
          />
        </div>
      </section>
    </div>
  );
}
