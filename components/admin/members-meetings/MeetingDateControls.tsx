"use client";

/**
 * The two presses that are the MEETING's own, not its event page's.
 *
 * ⛔ Everything else about a members' meeting — the hour, the venue, the
 * address, the joining link, the page copy — is edited by `EventForm`, the one
 * form this codebase has for an event, embedded on the meeting page. There was
 * a second form here once that re-implemented six of EventForm's fields and
 * lost its Google Places address lookup in the process. It is gone. If you are
 * about to add a field here, ask first whether it is an event field; if it is,
 * it already has a control.
 *
 * What is left is the pair EventForm genuinely cannot do:
 *
 *  - the DATE, because it is governance. The election joins to the meeting on
 *    `meeting_date` and derives its nomination, ballot and notice windows from
 *    it, so moving it is not an edit but a re-derivation. It locks once an
 *    election is built on it.
 * ⛔ PUBLISHING is not here either. It is a stage of the meeting, so its press
 * lives in the spine (`ElectionTimeline` on the meeting page) alongside notice
 * and the package. A second publish button beside the event details is what was
 * here before, and two presses for one act is the thing this section exists to
 * undo.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleMembersMeetingAction } from "@/lib/actions/members-meetings";

export interface MeetingDateFormProps {
  meetingId: string | null;
  meetingDate: string;
  /** Set when an election is already built on this date — the date locks. */
  electionLabel: string | null;
}

export default function MeetingDateForm(props: MeetingDateFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(props.meetingDate);

  const locked = !!props.electionLabel;
  const isNew = !props.meetingId;

  function save() {
    setError(null);
    setSaved(false);
    if (!date) return setError("Pick the date the meeting is held.");

    const fd = new FormData();
    if (props.meetingId) fd.set("meetingId", props.meetingId);
    fd.set("meetingDate", date);

    start(async () => {
      const r = await scheduleMembersMeetingAction(fd);
      if (!r.ok) return setError(r.error);
      setSaved(true);
      if (isNew && r.meetingId) router.push(`/admin/members-meetings/${r.meetingId}`);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">
        {isNew ? "When does it sit?" : "When it sits"}
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        By-Law Part VII. The election&apos;s nomination, ballot and notice windows are all
        measured back from this day.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="meeting-date"
            className="block text-xs font-medium text-gray-700"
          >
            Date
          </label>
          <input
            id="meeting-date"
            type="date"
            value={date}
            disabled={locked || pending}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
        {!locked && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f54] disabled:opacity-50"
          >
            {pending ? "Saving…" : isNew ? "Call the meeting" : "Move the meeting"}
          </button>
        )}
      </div>

      {locked && (
        <p className="mt-2 text-xs text-amber-700">
          The date is fixed: the {props.electionLabel} is built on it. Notice may already have
          been given stating this day, and notice is discharged once. Moving the meeting means
          re-deriving the election schedule, so do it from the election.
        </p>
      )}
      {saved && !error && (
        <p className="mt-2 text-xs text-green-700">Saved.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
