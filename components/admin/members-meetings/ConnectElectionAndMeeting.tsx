"use client";

/**
 * Connecting an election to a members' meeting — ONE panel, used from BOTH
 * screens.
 *
 * Steve 2026-11-19: "When an AGM is created then can 'Connect Election?' ... and
 * the other way around also works, start an election and go to connect a
 * Members' Meeting and then if there isn't one already made we give them the
 * setup for a new one."
 *
 * ⛔ Not two panels. `side` decides which half is being chosen and what the
 * empty state offers; everything else — the derivation warning, the notice
 * caveat, the error surface — is identical by construction, because it IS the
 * same component. Two panels is how two screens start describing one act
 * differently.
 *
 * ⛔ The panel says what connecting DOES, before it is pressed. It is not
 * bookkeeping: it derives the election's whole calendar from the day the meeting
 * sits and mints the dated obligations that follow from it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  connectElectionToMeetingAction,
  disconnectElectionFromMeetingAction,
} from "@/lib/actions/elections";

export interface ConnectOption {
  /** The election slug, or the meeting id, depending on `side`. */
  value: string;
  label: string;
  detail: string | null;
  /** Meetings only: notice has gone out, so connecting cannot later be undone. */
  noticeSent?: boolean;
}

export default function ConnectElectionAndMeeting({
  side,
  electionSlug,
  meetingId,
  options,
  connected,
  disconnectBlockedBecause,
}: {
  /**
   * "pick-meeting" — on the election screen, choosing which meeting.
   * "pick-election" — on the meeting screen, choosing which election.
   */
  side: "pick-meeting" | "pick-election";
  /** Known when side is "pick-meeting"; chosen from `options` otherwise. */
  electionSlug: string | null;
  /** Known when side is "pick-election"; chosen from `options` otherwise. */
  meetingId: string | null;
  options: ConnectOption[];
  /**
   * Already connected: the panel reports the pairing instead of offering it.
   *
   * `facts` and `href` are what the old "The election" / "The meeting" card used
   * to show. They live here so there is ONE surface for the connection and not
   * a card beside a panel saying overlapping things.
   */
  connected: {
    electionSlug: string;
    meetingId: string;
    summary: string;
    facts?: { label: string; value: string }[];
    href?: string | null;
    hrefLabel?: string;
  } | null;
  /** Non-null when a connection exists but may no longer be undone. */
  disconnectBlockedBecause: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>("");

  const pickingMeeting = side === "pick-meeting";
  const chosen = options.find((o) => o.value === choice) ?? null;

  function submit(action: "connect" | "disconnect", value: string) {
    start(async () => {
      setError(null);
      const fd = new FormData();
      if (pickingMeeting) {
        fd.set("electionSlug", electionSlug ?? "");
        fd.set("meetingId", action === "disconnect" ? (connected?.meetingId ?? "") : value);
      } else {
        fd.set("electionSlug", value);
        fd.set("meetingId", meetingId ?? "");
      }
      const r =
        action === "connect"
          ? await connectElectionToMeetingAction(fd)
          : await disconnectElectionFromMeetingAction(fd);
      if (!r.ok) setError(r.error ?? "That did not work.");
      else router.refresh();
    });
  }

  // -- Already connected -----------------------------------------------------
  if (connected) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">
          {pickingMeeting ? "The members' meeting" : "The election"}
        </h2>
        <p className="mt-1 text-sm text-gray-700">{connected.summary}</p>

        {connected.facts && connected.facts.length > 0 && (
          <dl className="mt-3 space-y-1">
            {connected.facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-4 text-sm">
                <dt className="text-gray-500">{f.label}</dt>
                <dd className="text-gray-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {connected.href && (
          <Link
            href={connected.href}
            className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
          >
            {connected.hrefLabel ?? "Open"} &rarr;
          </Link>
        )}

        {disconnectBlockedBecause ? (
          <p className="mt-2 text-xs text-amber-700">{disconnectBlockedBecause}</p>
        ) : (
          <div className="mt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => submit("disconnect", connected.electionSlug)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Disconnecting returns the election to setup and clears its nomination, ballot and
              notice windows, because every one of them is measured back from this meeting.
            </p>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </section>
    );
  }

  // -- Nothing to connect to -------------------------------------------------
  if (options.length === 0) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">
          {pickingMeeting ? "Connect a members' meeting" : "Connect an election"}
        </h2>
        {pickingMeeting ? (
          <>
            <p className="mt-1 text-sm text-gray-700">
              This election has no calendar yet. When nominations open and close, when ballots
              go out and close, when notice is due — all of it is measured back from the day the
              meeting sits, so there is nothing to schedule until a meeting exists.
            </p>
            <Link
              href="/admin/members-meetings/new"
              className="mt-3 inline-block rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f54]"
            >
              Schedule the meeting
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-700">
              No election is waiting to be connected. A meeting of the members does not need
              one — notice, the proxy deadline and the package are the meeting&apos;s own
              obligations either way.
            </p>
            <Link
              href="/admin/elections"
              className="mt-3 inline-block rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f54]"
            >
              Open an election
            </Link>
          </>
        )}
      </section>
    );
  }

  // -- Choose one ------------------------------------------------------------
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">
        {pickingMeeting ? "Connect a members' meeting" : "Connect an election"}
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        {pickingMeeting
          ? "This derives the election's nomination, ballot and notice windows from the day the meeting sits, and puts the dated obligations on the board's list. Until it is connected the election has no calendar."
          : "This derives the election's nomination, ballot and notice windows from the day THIS meeting sits, and puts the dated obligations on the board's list."}
      </p>

      <select
        value={choice}
        disabled={pending}
        onChange={(e) => setChoice(e.target.value)}
        className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
      >
        <option value="">{pickingMeeting ? "Choose a meeting…" : "Choose an election…"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.detail ? ` — ${o.detail}` : ""}
          </option>
        ))}
      </select>

      {chosen?.noticeSent && (
        <p className="mt-2 text-xs text-amber-700">
          Notice of that meeting has already gone out. Connecting is still allowed, but it
          cannot then be undone — notice names the day and is discharged once.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !choice}
          onClick={() => submit("connect", choice)}
          className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f54] disabled:opacity-50"
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
        <Link
          href={pickingMeeting ? "/admin/members-meetings/new" : "/admin/elections"}
          className="text-xs text-gray-600 underline"
        >
          {pickingMeeting ? "Or schedule a new meeting" : "Or open another election"}
        </Link>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
