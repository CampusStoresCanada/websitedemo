"use client";

import { useState, useTransition } from "react";
import LocalDate from "@/components/ui/LocalDate";
import type { BoardRenewalReport, BoardRenewalTypeReport } from "@/lib/renewal/board-report";
import type { RenewalOrgType } from "@/lib/renewal/renewal-progress";
import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  CHANNEL_LABEL,
  OUTCOME_LABEL,
  type ContactChannel,
  type ContactOutcome,
} from "@/lib/renewal/outreach";
import { logRenewalContactAction, setRenewalAssignmentAction } from "@/lib/actions/renewal-outreach";
import {
  pullRenewalSnapshotAction,
  approveRenewalSnapshotAction,
} from "@/lib/actions/renewal-snapshot";
import type { RenewalSnapshot, RenewalDelta } from "@/lib/renewal/snapshot";
import type { AssignableMember } from "@/lib/renewal/outreach";

interface Props {
  report: BoardRenewalReport;
  /** When present, THIS is what the board sees — the live report is only the
   *  fallback for a meeting nobody has frozen yet. */
  snapshot: RenewalSnapshot | null;
  delta: RenewalDelta | null;
  meetingId: string;
  meetingDate: string;
  eventSlug: string;
  /** Current board and officers, from governance_role_assignments. */
  assignableMembers: AssignableMember[];
  /** LIVE assignment per org id — deliberately not read off the snapshot. The
   *  figures freeze to a meeting; who owns the conversation does not. */
  assignmentsByOrg: Record<string, string>;
}

/**
 * Hand one organization's renewal conversation to somebody.
 *
 * Lives on the row rather than on a separate screen because this is what a
 * board actually does in the room — someone says "I'll take Algonquin" while
 * the list is on the projector, and it has to be one click to record that.
 */
function AssignControl({
  organizationId,
  renewalYear,
  assignedTo,
  members,
  eventSlug,
}: {
  organizationId: string;
  renewalYear: number;
  assignedTo: string | null;
  members: AssignableMember[];
  eventSlug: string;
}) {
  const [value, setValue] = useState<string>(assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setRenewalAssignmentAction({
        organizationId,
        renewalYear,
        assignedTo: next || null,
        eventSlug,
      });
      if (!res.success) {
        setValue(previous);
        setError(res.error ?? "Could not save.");
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <label className="sr-only" htmlFor={`as-${organizationId}`}>Assign to</label>
      <select
        id={`as-${organizationId}`}
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className={`text-xs rounded border px-1.5 py-0.5 max-w-[11rem] ${
          value ? "border-gray-300 bg-white text-gray-700" : "border-dashed border-gray-300 bg-transparent text-gray-400"
        }`}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.profileId} value={m.profileId}>
            {m.displayName}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-[#9C0006]">{error}</span>}
    </span>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function signedMoney(cents: number): string {
  const v = money(Math.abs(cents));
  return cents < 0 ? `−${v}` : `+${v}`;
}

/**
 * Where the figures on this tab came from, and what to do about it.
 *
 * A board document that silently recomputes is worse than no document: the
 * minutes cite a number, the cycle moves, and the page stops agreeing with the
 * record. So provenance is stated on the face of it rather than implied.
 */
function SnapshotBar({
  snapshot,
  meetingId,
  meetingDate,
  eventSlug,
}: {
  snapshot: RenewalSnapshot | null;
  meetingId: string;
  meetingDate: string;
  eventSlug: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong.");
    });
  };

  const approved = Boolean(snapshot?.approvedAt);

  return (
    <div
      className={`rounded-lg border p-3 mb-4 flex flex-wrap items-center justify-between gap-3 ${
        approved
          ? "border-green-200 bg-green-50/60"
          : snapshot
            ? "border-gray-200 bg-gray-50"
            : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="text-xs">
        {approved ? (
          <>
            <span className="font-semibold text-green-800">Approved figure of record.</span>{" "}
            <span className="text-gray-600">
              Frozen <LocalDate iso={snapshot!.pulledAt} format="short" />, approved{" "}
              <LocalDate iso={snapshot!.approvedAt!} format="short" />. It will not change again.
            </span>
          </>
        ) : snapshot ? (
          <>
            <span className="font-semibold text-gray-700">Frozen for this meeting.</span>{" "}
            <span className="text-gray-600">
              Pulled <LocalDate iso={snapshot.pulledAt} format="short" />. Re-pull to refresh,
              or approve to fix it as the figure of record.
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold text-amber-900">Live figures, not yet frozen.</span>{" "}
            <span className="text-gray-700">
              These move as payments arrive. Freeze them before citing any number in the
              minutes, or it won&rsquo;t reproduce later.
            </span>
          </>
        )}
        {error && <span className="block text-[#9C0006] mt-1">{error}</span>}
      </div>

      {!approved && (
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                pullRenewalSnapshotAction({ meetingId, meetingDate, eventSlug })
              )
            }
            className="text-xs font-semibold px-3 py-1.5 rounded bg-[#163D6D] text-white disabled:opacity-50"
          >
            {pending ? "Working…" : snapshot ? "Re-pull" : "Freeze these figures"}
          </button>
          {snapshot && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveRenewalSnapshotAction({ meetingId, eventSlug }))}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Approve
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Logging a call has to be a byproduct of working the list, not a second
 * screen. contacts.last_contact_date already exists and is populated on 12 of
 * 952 rows — the field was never the problem, the extra step was. So the form
 * opens in place on the row the caller is already looking at.
 */
function LogContactForm({
  organizationId,
  renewalYear,
  eventSlug,
  onDone,
}: {
  organizationId: string;
  renewalYear: number;
  eventSlug: string;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [outcome, setOutcome] = useState<ContactOutcome>("undecided");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await logRenewalContactAction({
        organizationId,
        renewalYear,
        channel,
        outcome,
        note: note || null,
        eventSlug,
      });
      if (res.success) onDone();
      else setError(res.error ?? "Could not save.");
    });
  };

  return (
    <div className="mt-2 mb-1 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`ch-${organizationId}`}>How</label>
        <select
          id={`ch-${organizationId}`}
          value={channel}
          onChange={(e) => setChannel(e.target.value as ContactChannel)}
          className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
        >
          {CONTACT_CHANNELS.map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`oc-${organizationId}`}>Outcome</label>
        <select
          id={`oc-${organizationId}`}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as ContactOutcome)}
          className="text-xs rounded border border-gray-300 px-2 py-1 bg-white"
        >
          {CONTACT_OUTCOMES.map((o) => (
            <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What did they say? This is the part worth having next August."
        className="w-full text-sm rounded border border-gray-300 px-2 py-1.5 bg-white"
      />
      {error && <p className="text-xs text-[#9C0006]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-[#163D6D] text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

const TYPE_LABEL: Record<string, string> = {
  Member: "Members",
  "Vendor Partner": "Vendor Partners",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold text-[#163D6D] mt-0.5 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function TypePanel({
  type,
  renewalYear,
  eventSlug,
  members,
  assignmentsByOrg,
}: {
  type: BoardRenewalTypeReport;
  renewalYear: number;
  eventSlug: string;
  members: AssignableMember[];
  assignmentsByOrg: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
  // Counted from live assignments rather than type.assignedCount, which is
  // frozen into the snapshot alongside the figures.
  const assignedNow = type.outstanding.filter((o) => assignmentsByOrg[o.organizationId]).length;
  const renewedPct = type.populationCount === 0 ? 0 : type.renewedCount / type.populationCount;

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {TYPE_LABEL[type.orgType] ?? type.orgType}
        </h3>
        <span className="text-xs text-gray-500 tabular-nums">
          {type.renewedCount} of {type.populationCount} renewed ·{" "}
          {pct(type.renewedCount, type.populationCount)}
        </span>
      </div>

      <div
        className="h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-4"
        role="img"
        aria-label={`${pct(type.renewedCount, type.populationCount)} renewed`}
      >
        <div
          className="h-full rounded-full bg-[#163D6D] transition-all"
          style={{ width: `${Math.round(renewedPct * 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Stat label="Collected" value={money(type.collectedCents)} hint="excludes tax" />
        <Stat
          label="Outstanding"
          value={money(type.outstandingCents)}
          hint={`${type.outstanding.length} ${
            type.outstanding.length === 1 ? "organization" : "organizations"
          }`}
        />
      </div>

      {type.outstanding.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            {type.contactedCount} of {type.outstanding.length} spoken to
            {assignedNow > 0 && ` · ${assignedNow} assigned`}
            {type.contactedCount === 0 && type.outstanding.length > 0 && (
              <span className="text-[#9C0006] font-medium"> — nobody has been called yet</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#EE2A2E] hover:underline"
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} the {type.outstanding.length} still to renew
            <svg
              className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
              {type.outstanding.map((org) => (
                <li key={org.organizationId} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-700 min-w-0 truncate">{org.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {org.lastContactedAt ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-800"
                          title={`${org.contactCount} contact${org.contactCount === 1 ? "" : "s"} logged`}
                        >
                          spoken to
                        </span>
                      ) : null}
                      <AssignControl
                        organizationId={org.organizationId}
                        renewalYear={renewalYear}
                        assignedTo={assignmentsByOrg[org.organizationId] ?? null}
                        members={members}
                        eventSlug={eventSlug}
                      />
                      <span className="text-gray-500 tabular-nums">{money(org.amountCents)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setLogging((v) => (v === org.organizationId ? null : org.organizationId))
                        }
                        className="text-xs font-semibold text-[#EE2A2E] hover:underline"
                      >
                        {logging === org.organizationId ? "Close" : "Log contact"}
                      </button>
                    </span>
                  </div>
                  {logging === org.organizationId && (
                    <LogContactForm
                      organizationId={org.organizationId}
                      renewalYear={renewalYear}
                      eventSlug={eventSlug}
                      onDone={() => setLogging(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingRenewalsTab({
  report,
  snapshot,
  delta,
  meetingId,
  meetingDate,
  eventSlug,
  assignableMembers,
  assignmentsByOrg,
}: Props) {
  // The frozen figures win wherever they exist. The live report stays the
  // fallback for a meeting nobody has frozen yet, and the source is stated in
  // the bar above rather than left for the reader to guess.
  const shown = snapshot?.report ?? report;
  const { totals } = shown;
  const orgTypes = Object.keys(shown.types) as RenewalOrgType[];

  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700">
          Renewal Progress — {shown.cycleLabel} cycle
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Meeting {meetingDate}. Figures exclude tax.
        </p>
      </div>

      <SnapshotBar
        snapshot={snapshot}
        meetingId={meetingId}
        meetingDate={meetingDate}
        eventSlug={eventSlug}
      />

      {delta && (
        <div className="rounded-lg border border-gray-200 p-3 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Since the {delta.sinceMeetingDate} meeting
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-700">
              <strong className="text-[#163D6D] tabular-nums">{signed(delta.renewedDelta)}</strong> renewed
            </span>
            <span className="text-gray-700">
              <strong className="text-[#163D6D] tabular-nums">{signedMoney(delta.collectedCentsDelta)}</strong> collected
            </span>
            <span className="text-gray-700">
              <strong className="text-[#163D6D] tabular-nums">{signed(delta.contactedDelta)}</strong> spoken to
            </span>
            <span className="text-gray-500">
              {signed(delta.outstandingCountDelta)} outstanding
            </span>
          </div>
        </div>
      )}

      {/* Headline — the number the board is being asked to act on */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-5 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat
            label="Renewed"
            value={`${totals.renewedCount} / ${totals.populationCount}`}
            hint={pct(totals.renewedCount, totals.populationCount)}
          />
          <Stat label="Collected" value={money(totals.collectedCents)} />
          <Stat label="Outstanding" value={money(totals.outstandingCents)} />
          <Stat
            label="Still to renew"
            value={String(totals.outstandingCount)}
            hint={
              totals.outstandingCount > 0
                ? "organizations needing contact"
                : "everyone is renewed"
            }
          />
          <Stat
            label="Spoken to"
            value={`${totals.contactedCount} / ${totals.outstandingCount}`}
            hint={
              totals.outstandingCount === 0
                ? "nothing outstanding"
                : `${totals.assignedCount} assigned to someone`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {orgTypes.map((key) => (
          <TypePanel
            key={key}
            type={shown.types[key]}
            renewalYear={shown.renewalYear}
            eventSlug={eventSlug}
            members={assignableMembers}
            assignmentsByOrg={assignmentsByOrg}
          />
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Renewal is counted from the payment event, not invoice status — dues paid inside a
        booth checkout void the standalone invoice rather than paying it, and would otherwise
        read as unpaid.
      </p>
    </div>
  );
}
