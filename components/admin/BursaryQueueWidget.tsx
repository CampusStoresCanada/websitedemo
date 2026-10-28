"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BURSARY_STATUSES,
  BURSARY_STATUS_LABELS,
  isBursaryStatus,
  type BursaryStatus,
} from "@/lib/conference/bursary-status";
// Type-only: bursary-widget.ts reaches the database, and an erased import is
// what keeps it out of this bundle.
import type { BursaryApplicationRow, BursaryQueueData } from "@/lib/conference/bursary-widget";
import { setBursaryApplicationStatus } from "@/lib/actions/conference-bursary";

/**
 * Travel-bursary applications, on the admin console's front page.
 *
 * A queue, not a dashboard — in the same idiom as the board action list, and
 * for the same reason: the job is to get rows decided, so the one control on a
 * row is the decision, taken in place.
 *
 * ⚠️ Rows are registrations of interest. Nothing here scores or ranks them;
 * oldest sits at the top because that institution has waited longest, and the
 * only thing this widget writes is a status a human picked.
 *
 * Colours and geometry are the approved board-checklist card's.
 */

const NAVY = "#16345a";
const CARD = "#e6e6e6";
const ROW = "#f2f2f2";
const TRACK = "#ccc";
const MUTED = "#999";

const STATUS_STYLE: Record<BursaryStatus, { bg: string; fg: string }> = {
  submitted: { bg: TRACK, fg: "#555" },
  approved: { bg: "#009245", fg: "#fff" },
  denied: { bg: "#8a8f98", fg: "#fff" },
  fulfilled: { bg: NAVY, fg: "#fff" },
};

type Tab = "review" | "decided";

function statusLabel(status: string): string {
  return isBursaryStatus(status) ? BURSARY_STATUS_LABELS[status] : status;
}

function Row({
  row,
  busy,
  onSetStatus,
}: {
  row: BursaryApplicationRow;
  busy: boolean;
  onSetStatus: (id: string, status: BursaryStatus) => void;
}) {
  const style = isBursaryStatus(row.status) ? STATUS_STYLE[row.status] : { bg: TRACK, fg: "#555" };

  const waited =
    row.daysWaiting === 0
      ? "today"
      : row.daysWaiting === 1
        ? "1 day"
        : `${row.daysWaiting} days`;

  return (
    <div
      className="grid items-center gap-2 rounded-2xl px-3 py-2.5"
      style={{
        background: ROW,
        gridTemplateColumns: "minmax(0,1fr) 44px 64px 118px",
        opacity: busy ? 0.55 : 1,
      }}
    >
      {/* Institution + who asked */}
      <div className="min-w-0">
        {row.organizationSlug ? (
          <Link
            href={`/org/${row.organizationSlug}`}
            className="block truncate text-[14px] font-medium hover:underline"
            style={{ color: NAVY }}
          >
            {row.organizationName}
          </Link>
        ) : (
          <p className="truncate text-[14px] font-medium" style={{ color: NAVY }}>
            {row.organizationName}
          </p>
        )}
        <p className="truncate text-[12px]" style={{ color: MUTED }}>
          {row.contactName} ·{" "}
          <a href={`mailto:${row.contactEmail}`} className="hover:underline">
            {row.contactEmail}
          </a>
          {row.submittedOn && ` · ${row.submittedOn}`}
        </p>
        {row.request ? (
          <p className="truncate text-[12px] text-gray-700">
            {[row.request.hotel && "Hotel", row.request.travel && "Travel"].filter(Boolean).join(" + ")}
            {row.request.payment && ` · ${row.request.payment === "reimburse" ? "reimburse after" : "pay in advance"}`}
            {row.request.delegateName &&
              ` · for ${row.request.delegateName}${row.request.delegateTitle ? `, ${row.request.delegateTitle}` : ""}`}
          </p>
        ) : (
          <p className="truncate text-[12px] italic" style={{ color: MUTED }}>
            Interest only: request not submitted yet
          </p>
        )}
        {row.notes && (
          <p className="truncate text-[12px] italic text-gray-600" title={row.notes}>
            {row.notes}
          </p>
        )}
      </div>

      {/* Province — the travel in travel bursary */}
      <span className="text-center text-[12px] font-medium" style={{ color: MUTED }}>
        {row.province ?? "—"}
      </span>

      {/* How long they have been waiting */}
      <span className="text-right text-[12px]" style={{ color: row.daysWaiting >= 30 ? "#a3282b" : MUTED }}>
        {waited}
      </span>

      {/* The decision — a select dressed as the pill it sets */}
      <label className="relative cursor-pointer justify-self-end">
        <span
          className="flex h-[22px] w-[118px] items-center justify-center rounded-full text-[11px] font-medium"
          style={{ background: style.bg, color: style.fg }}
        >
          {statusLabel(row.status)}
        </span>
        <select
          value={isBursaryStatus(row.status) ? row.status : ""}
          onChange={(e) => {
            const next = e.target.value;
            if (isBursaryStatus(next)) onSetStatus(row.id, next);
          }}
          disabled={busy}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`Bursary decision for ${row.organizationName}`}
        >
          {!isBursaryStatus(row.status) && <option value="">{row.status}</option>}
          {BURSARY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BURSARY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function BursaryQueueWidget({ data }: { data: BursaryQueueData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const awaiting = useMemo(() => data.rows.filter((r) => r.status === "submitted"), [data.rows]);
  const decided = useMemo(() => data.rows.filter((r) => r.status !== "submitted"), [data.rows]);
  const visible = tab === "review" ? awaiting : decided;

  async function onSetStatus(id: string, status: BursaryStatus) {
    setBusyId(id);
    setError(null);
    const result = await setBursaryApplicationStatus({ applicationId: id, status });
    setBusyId(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className="pb-1.5 text-[15px] font-medium transition-colors"
      style={{
        color: tab === id ? NAVY : "#9a9b9b",
        borderBottom: tab === id ? `2px solid ${NAVY}` : "2px solid transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col rounded-[22px] p-4" style={{ background: CARD, height: 310 }}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
          Travel bursary
        </h2>
        <span className="truncate text-[11px]" style={{ color: MUTED }}>
          {data.conferenceName}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-6">
        <TabButton id="review" label={`To review (${awaiting.length})`} />
        <TabButton id="decided" label={`Decided (${decided.length})`} />
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-white px-3 py-2 text-[12px]" style={{ color: "#a3282b" }}>
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <div className="rounded-2xl py-10 text-center text-[13px]" style={{ background: ROW, color: MUTED }}>
            {tab === "review" ? "Every application has a decision." : "No decisions recorded yet."}
          </div>
        ) : (
          visible.map((row) => (
            <Row key={row.id} row={row} busy={busyId === row.id} onSetStatus={onSetStatus} />
          ))
        )}
      </div>
    </div>
  );
}
