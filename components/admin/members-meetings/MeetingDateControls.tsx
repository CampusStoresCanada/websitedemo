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
import {
  MEMBERS_MEETING_DESCRIPTIONS,
  MEMBERS_MEETING_LABELS,
  MEMBERS_MEETING_TYPES,
  type MembersMeetingType,
} from "@/lib/governance/members-meetings";

export interface MeetingDateFormProps {
  meetingId: string | null;
  meetingDate: string;
  /** Set when an election is already built on this date — the date locks. */
  electionLabel: string | null;
  meetingType: MembersMeetingType;
  /**
   * Whether the KIND can still be chosen. Only when calling a new one: the type
   * decides the event's slug, and a meeting already has an event page at it.
   */
  allowTypeChange?: boolean;
  /**
   * The date the by-law rule puts the next AGM on, offered back when the kind
   * is switched to "agm" — a special meeting's date is the board's to pick, an
   * AGM's is derived.
   */
  agmSuggestion?: string;
}

export default function MeetingDateForm(props: MeetingDateFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(props.meetingDate);
  const [type, setType] = useState<MembersMeetingType>(props.meetingType);

  const locked = !!props.electionLabel;
  const isNew = !props.meetingId;
  const canChooseType = !!props.allowTypeChange && isNew;

  function save() {
    setError(null);
    setSaved(false);
    if (!date) return setError("Pick the date the meeting is held.");

    const fd = new FormData();
    if (props.meetingId) fd.set("meetingId", props.meetingId);
    fd.set("meetingDate", date);
    fd.set("meetingType", type);

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
        {isNew ? "What kind, and when?" : "When it sits"}
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        By-Law Part VII. The notice window, the proxy deadline and any election&apos;s
        nomination and ballot windows are all measured back from this day.
      </p>

      {canChooseType && (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-xs font-medium text-gray-700">Kind of meeting</legend>
          {MEMBERS_MEETING_TYPES.map((t) => (
            <label key={t} className="flex items-start gap-2">
              <input
                type="radio"
                name="kind"
                value={t}
                checked={type === t}
                disabled={pending}
                onChange={() => {
                  setType(t);
                  // An AGM's date comes from the rule; a special meeting's is
                  // the board's to pick, so clear the suggestion rather than
                  // leaving an unrelated date sitting in the field.
                  if (t === "agm") setDate(props.agmSuggestion ?? "");
                  else if (date === props.agmSuggestion) setDate("");
                }}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  {MEMBERS_MEETING_LABELS[t]}
                </span>
                <span className="block text-xs text-gray-500">
                  {MEMBERS_MEETING_DESCRIPTIONS[t]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

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
            {pending
              ? "Saving…"
              : isNew
                ? `Call the ${MEMBERS_MEETING_LABELS[type].toLowerCase()}`
                : "Move the meeting"}
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
