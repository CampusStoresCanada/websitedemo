"use client";

/**
 * Setting up a members' meeting: when it sits, and where.
 *
 * ⚠️ Times are converted here, in the browser, on purpose. `datetime-local`
 * gives back a naive "YYYY-MM-DDTHH:mm" with no zone, and `new Date(...)` on it
 * parses in the RUNTIME's timezone — which on Vercel is UTC, so doing this on
 * the server would silently shift every meeting by six hours. Same reason
 * `EventForm` does it client-side.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  scheduleMembersMeetingAction,
  publishMembersMeetingEventAction,
} from "@/lib/actions/members-meetings";
import { VENUE_LABELS, type MeetingVenue } from "@/lib/governance/members-meetings";
import { parseUTC } from "@/lib/utils";

/**
 * A stored timestamp, as a `datetime-local` input wants it: the reader's local
 * time. `parseUTC` is the normalizer — Supabase hands these back without a `Z`,
 * and a bare `new Date()` on one parses it as local, which silently shifts
 * every meeting by the offset.
 */
function toLocalInput(stored: string | null): string {
  if (!stored) return "";
  const d = parseUTC(stored);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export interface MembersMeetingSetupProps {
  meetingId: string | null;
  meetingDate: string;
  startsAt: string | null;
  endsAt: string | null;
  isVirtual: boolean | null;
  location: string | null;
  virtualLink: string | null;
  eventStatus: string | null;
  /** Set when an election is already built on this date — the date locks. */
  electionLabel: string | null;
}

const VENUES: MeetingVenue[] = ["in_person", "virtual", "hybrid"];

export default function MembersMeetingSetup(props: MembersMeetingSetupProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [date, setDate] = useState(props.meetingDate);
  const [startLocal, setStartLocal] = useState(toLocalInput(props.startsAt));
  const [endLocal, setEndLocal] = useState(toLocalInput(props.endsAt));
  const [venue, setVenue] = useState<MeetingVenue>(
    props.isVirtual && props.location?.trim()
      ? "hybrid"
      : props.isVirtual
        ? "virtual"
        : "in_person"
  );
  const [location, setLocation] = useState(props.location ?? "");
  const [virtualLink, setVirtualLink] = useState(props.virtualLink ?? "");

  const dateLocked = !!props.electionLabel;

  function save() {
    setError(null);
    setSaved(false);

    if (!date) return setError("Pick the date the meeting is held.");
    if (!startLocal) return setError("Set the time the meeting starts.");

    const fd = new FormData();
    if (props.meetingId) fd.set("meetingId", props.meetingId);
    fd.set("meetingDate", date);
    fd.set("startsAt", new Date(startLocal).toISOString());
    if (endLocal) fd.set("endsAt", new Date(endLocal).toISOString());
    fd.set("venue", venue);
    fd.set("location", location);
    fd.set("virtualLink", virtualLink);

    start(async () => {
      const res = await scheduleMembersMeetingAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      if (!props.meetingId && res.meetingId) {
        router.push(`/admin/members-meetings/${res.meetingId}`);
        return;
      }
      router.refresh();
    });
  }

  function publish() {
    if (!props.meetingId) return;
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await publishMembersMeetingEventAction(props.meetingId!);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">When and where</h2>
      <p className="mt-1 text-xs text-gray-500">
        The date, the times and the place are the board&apos;s to decide. The title, the web
        address of the event page and its members-only audience follow from them.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">Date</span>
          <input
            type="date"
            value={date}
            disabled={dateLocked || pending}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
          />
          {dateLocked && (
            <span className="mt-1 block text-[11px] text-amber-700">
              Locked: the {props.electionLabel} is built on this date. Its nomination, ballot
              and notice windows are all measured back from it, so move the meeting from the
              election, not here.
            </span>
          )}
        </label>

        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">How it is attended</span>
          <select
            value={venue}
            disabled={pending}
            onChange={(e) => setVenue(e.target.value as MeetingVenue)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {VENUES.map((v) => (
              <option key={v} value={v}>
                {VENUE_LABELS[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">Starts</span>
          <input
            type="datetime-local"
            value={startLocal}
            disabled={pending}
            onChange={(e) => setStartLocal(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-[11px] text-gray-400">Your local time.</span>
        </label>

        <label className="text-xs text-gray-600">
          <span className="block font-medium text-gray-900">Ends</span>
          <input
            type="datetime-local"
            value={endLocal}
            disabled={pending}
            onChange={(e) => setEndLocal(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        {venue !== "virtual" && (
          <label className="text-xs text-gray-600 sm:col-span-2">
            <span className="block font-medium text-gray-900">Address</span>
            <input
              type="text"
              value={location}
              disabled={pending}
              placeholder="Venue and city"
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}

        {venue !== "in_person" && (
          <label className="text-xs text-gray-600 sm:col-span-2">
            <span className="block font-medium text-gray-900">Joining link</span>
            <input
              type="url"
              value={virtualLink}
              disabled={pending}
              placeholder="Leave blank to have one made when you publish"
              onChange={(e) => setVirtualLink(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {saved && !error && <p className="mt-3 text-xs text-green-700">Saved.</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-[#163D6D] px-4 py-2 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50"
        >
          {pending ? "Saving…" : props.meetingId ? "Save the details" : "Schedule the meeting"}
        </button>

        {props.meetingId && props.eventStatus === "draft" && (
          <button
            type="button"
            onClick={publish}
            disabled={pending}
            className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20] disabled:opacity-50"
          >
            Publish the event page
          </button>
        )}
      </div>

      {props.meetingId && props.eventStatus === "draft" && (
        <p className="mt-3 text-xs text-amber-700">
          Publishing is what calls the meeting in public: members can see the page, it goes into
          the calendar, and an online meeting gets its joining link. Notice cannot be sent while
          the page is a draft, because the notice links to it.
        </p>
      )}
    </section>
  );
}
