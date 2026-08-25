"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addConferenceAttendee,
  allocateSeat,
  deallocateSeat,
} from "@/lib/actions/conference-entity-commerce";

/**
 * Putting people into the places an organisation has bought.
 *
 * Every action behind this already existed — allocateSeat, deallocateSeat,
 * addConferenceAttendee — and no interface ever called them. The checklist
 * asked companies to "assign your booth staff" and then offered them nowhere
 * to do it, which is why 163 places across this conference have nobody on
 * them and one seat in 149 is filled.
 *
 * Grouped by what the place is FOR, not by seat id: "two of your four staff
 * passes" is the question someone actually has. A bare list of seat rows is
 * the database's shape, not theirs.
 */

export interface SeatRow {
  id: string;
  entityId: string;
  name: string;
  kind: string;
  seatIndex: number;
  holderPersonId: string | null;
  holderName: string | null;
}

export interface AttendeeOption {
  id: string;
  name: string;
}

/**
 * What is true about a person, in the reader's words.
 *
 * The page used to carry a separate eight-column table of `person_kind`,
 * `assignment_status`, `badge_print_status` and "Access (from seats)" — the
 * database's vocabulary, next to a panel that decides exactly those values.
 * Cause and effect shown as unrelated tables. This folds the parts a company
 * can act on into the place where they act.
 */
export interface PersonStatus {
  /** No account yet — they cannot accept agreements or see their own page. */
  hasAccount: boolean;
  /** Required details still missing (travel data, flags). */
  missingCount: number;
  badgePrinted: boolean;
  checkedIn: boolean;
}

export default function SeatAssignment({
  seats,
  people,
  statusByPerson,
  conferenceId,
  organizationId,
}: {
  seats: SeatRow[];
  people: AttendeeOption[];
  statusByPerson: Record<string, PersonStatus>;
  conferenceId: string;
  organizationId: string;
}) {
  // Nobody attends a membership renewal — it occupies a seat row but is not a
  // place at the conference, and listing it invites someone to "assign" it.
  const attendable = seats.filter((s) => s.kind !== "membership_renewal");
  if (attendable.length === 0) return null;

  const groups = new Map<string, SeatRow[]>();
  for (const seat of attendable) {
    const list = groups.get(seat.name) ?? [];
    list.push(seat);
    groups.set(seat.name, list);
  }

  const filled = attendable.filter((s) => s.holderPersonId).length;
  const needAttention = new Set(
    attendable
      .map((s) => s.holderPersonId)
      .filter((id): id is string => !!id)
      .filter((id) => {
        const st = statusByPerson[id];
        return st && (!st.hasAccount || st.missingCount > 0);
      })
  ).size;

  return (
    <section id="whos-going" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Who&rsquo;s going</h2>
        <p className="text-sm tabular-nums text-gray-500">
          {filled} of {attendable.length} places filled
          {needAttention > 0 ? ` · ${needAttention} need something` : ""}
        </p>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Put a name against each place your company has bought. Everyone here gets a badge, so
        a place left empty is a badge that can&rsquo;t be printed — and for a dinner or an
        offsite, a seat nobody can take. You can change any of this until badges are produced.
      </p>

      <div className="mt-4 space-y-5">
        {[...groups.entries()].map(([name, rows]) => (
          <EntityGroup
            key={name}
            name={name}
            rows={rows}
            people={people}
            statusByPerson={statusByPerson}
            conferenceId={conferenceId}
            organizationId={organizationId}
          />
        ))}
      </div>
    </section>
  );
}

function EntityGroup({
  name,
  rows,
  people,
  statusByPerson,
  conferenceId,
  organizationId,
}: {
  name: string;
  rows: SeatRow[];
  people: AttendeeOption[];
  statusByPerson: Record<string, PersonStatus>;
  conferenceId: string;
  organizationId: string;
}) {
  const assigned = rows.filter((r) => r.holderPersonId).length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 pb-1">
        <h3 className="text-sm font-semibold text-gray-900">{name}</h3>
        <span className="text-xs tabular-nums text-gray-500">
          {assigned} of {rows.length}
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {rows
          .slice()
          .sort((a, b) => a.seatIndex - b.seatIndex)
          .map((seat) => (
            <SeatLine
              key={seat.id}
              seat={seat}
              people={people}
              status={seat.holderPersonId ? statusByPerson[seat.holderPersonId] ?? null : null}
              conferenceId={conferenceId}
              organizationId={organizationId}
            />
          ))}
      </ul>
    </div>
  );
}

/**
 * Only what a company can act on, and only when it is true.
 *
 * Deliberately not a status column per person: "assigned", "not checked in"
 * and "badge pending" are the normal state for months and say nothing. A flag
 * appears when there is something to be done about it.
 */
function PersonFlags({ status }: { status: PersonStatus }) {
  const flags: { label: string; tone: string }[] = [];
  if (!status.hasAccount) flags.push({ label: "hasn't activated their account", tone: "text-amber-800" });
  if (status.missingCount > 0)
    flags.push({
      label: `${status.missingCount} detail${status.missingCount === 1 ? "" : "s"} missing`,
      tone: "text-amber-800",
    });
  if (status.checkedIn) flags.push({ label: "checked in", tone: "text-green-700" });
  else if (status.badgePrinted) flags.push({ label: "badge printed", tone: "text-gray-500" });
  if (flags.length === 0) return null;
  return (
    <span className="ml-2 text-xs font-normal">
      {flags.map((f, i) => (
        <span key={f.label} className={f.tone}>
          {i > 0 ? " · " : ""}
          {f.label}
        </span>
      ))}
    </span>
  );
}

function SeatLine({
  seat,
  people,
  status,
  conferenceId,
  organizationId,
}: {
  seat: SeatRow;
  people: AttendeeOption[];
  status: PersonStatus | null;
  conferenceId: string;
  organizationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  function assign(personId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await allocateSeat(seat.id, personId);
      if (result.success) {
        // A warning is not a failure — the seat IS allocated, and hiding the
        // caveat would be worse than showing it.
        if (result.data.warning) setNotice(result.data.warning);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function clear() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await deallocateSeat(seat.id);
      if (result.success) router.refresh();
      else setError(result.error);
    });
  }

  function addAndAssign() {
    if (!newName.trim()) {
      setError("Give them a name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const created = await addConferenceAttendee(conferenceId, organizationId, {
        displayName: newName,
        contactEmail: newEmail.trim() || null,
      });
      if (!created.success) {
        setError(created.error);
        return;
      }
      const seated = await allocateSeat(seat.id, created.data.id);
      if (!seated.success) {
        setError(seated.error);
        return;
      }
      setAddingNew(false);
      setNewName("");
      setNewEmail("");
      // Without an email there is nobody to invite — say so rather than
      // leaving someone waiting for a message that will never arrive.
      setNotice(
        created.data.invited
          ? "Added and invited by email."
          : "Added. No email given, so they haven't been invited — add one later if they need to sign in."
      );
      router.refresh();
    });
  }

  return (
    <li className="rounded-md border border-gray-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 flex-none text-xs tabular-nums text-gray-400">
          #{seat.seatIndex + 1}
        </span>

        {seat.holderPersonId ? (
          <>
            <span className="flex-1 text-sm font-medium text-gray-900">
              {seat.holderName ?? "Assigned"}
              {status ? <PersonFlags status={status} /> : null}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="text-xs text-gray-500 underline hover:text-gray-800 disabled:opacity-50"
            >
              {pending ? "Working…" : "Remove"}
            </button>
          </>
        ) : addingNew ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
              className="min-w-[9rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email (optional)"
              type="email"
              className="min-w-[11rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={addAndAssign}
              disabled={pending}
              className="rounded-md bg-[#163D6D] px-3 py-1 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => { setAddingNew(false); setError(null); }}
              className="text-xs text-gray-500 underline hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                if (e.target.value === "__new") setAddingNew(true);
                else if (e.target.value) assign(e.target.value);
              }}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 disabled:opacity-50"
            >
              <option value="">Nobody yet — choose someone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__new">+ Someone not on this list…</option>
            </select>
          </>
        )}
      </div>

      {error ? <p className="mt-1 pl-14 text-xs text-red-700">{error}</p> : null}
      {notice && !error ? <p className="mt-1 pl-14 text-xs text-gray-600">{notice}</p> : null}
    </li>
  );
}
