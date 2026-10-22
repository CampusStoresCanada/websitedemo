"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import TaskChecklist from "@/components/conference/TaskChecklist";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import type { StaffChecklist } from "@/lib/conference/checklist-tasks";
import type { StaffChecklistGroups } from "@/lib/conference/deadline-urgency";
import { formatCalendarDate, formatDayMonth } from "@/lib/time/supabase-timestamp";
import { useRouter } from "next/navigation";
import type { ConferenceAnswer } from "@/lib/conference/agenda";
import { submitFlag } from "@/lib/actions/submit-flag";
import { resolveFlag, type ConferenceAsk } from "@/lib/actions/flags";
import { PRINT_SORT_KEYS, type PrintSortKey } from "@/lib/conference/badges/arrangement";
import { setMyPrintSort } from "@/lib/actions/profile";
import { sendDocumentToPrinter } from "@/lib/actions/conference-badges";

type ConferencePerson = {
  id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  organization_id: string;
  assignment_status: string;
  badge_print_status: string;
  checked_in_at: string | null;
  travel_mode: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  dietary_restrictions: string | null;
  accessibility_needs: string | null;
  admin_notes: string | null;
};

type OpsTab = "whats_next" | "asks" | "answers" | "people";

const OPS_TABS: Array<{ id: OpsTab; label: string; adminOnly?: boolean }> = [
  { id: "whats_next", label: "What's next", adminOnly: true },
  { id: "asks", label: "Asks" },
  { id: "answers", label: "Answers" },
  { id: "people", label: "People Lookup" },
];

/** A meal's menu, for "what's for dinner?" at the desk. */
export type WarRoomMenu = { id: string; title: string; dayKey: string; startTime: string | null; menu: string };

const POLL_MS = 30_000;
const STALE_MS = POLL_MS * 2;

/**
 * CSC's run-sheet for the conference: the staff checklists, in order.
 *
 * Built on the server (the checks read the database; each task's live line and
 * buttons arrive as rendered nodes) and only for admins.
 */
export type WhatsNext = {
  /** CSC's own organization — whom a staff tick is filed under. */
  answeringOrgId: string | null;
  timeZone: string;
  groups: StaffChecklistGroups<StaffChecklist>;
  controlsByTaskId: Record<string, ReactNode>;
  /** The viewer's own order for printed name lists. */
  printSort: PrintSortKey;
};

/**
 * "Send to printer" on a task's document: onto the print station's queue, so it
 * is printing on the paper printer while you walk over to get it. Says so when
 * no station is online, because then nothing is printing it.
 */
export function SendToPrinterButton({ conferenceId, documentId }: { conferenceId: string; documentId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued_offline" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const label =
    state === "sending"
      ? "Sending…"
      : state === "sent"
        ? "Sent to printer"
        : state === "queued_offline"
          ? "Queued, but no print station is online"
          : "Send to printer";
  return (
    <>
      <button
        type="button"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          setError(null);
          const result = await sendDocumentToPrinter({ conferenceId, documentId });
          if (!result.success) {
            setState("error");
            setError(result.error);
            return;
          }
          setState(result.data.stationOnline ? "sent" : "queued_offline");
        }}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
          state === "sent"
            ? "bg-green-700 text-white"
            : state === "queued_offline"
              ? "bg-amber-600 text-white"
              : "bg-[#163D6D] text-white hover:bg-[#12325a]"
        }`}
      >
        {label}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </>
  );
}

const PRINT_SORT_LABELS: Record<PrintSortKey, string> = {
  person_first_name: "First name",
  person_last_name: "Last name",
  organization_name: "Organization",
};

/**
 * Set once, here, ahead of time: every printed name list (door lists, the
 * attendee list) comes out in this order for whoever prints it. Stephen: "it
 * shouldn't be while you are attempting the panic print on an iPad."
 */
function MyPrintSort({ initial }: { initial: PrintSortKey }) {
  const [sort, setSort] = useState<PrintSortKey>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-[18px] py-3">
      <span className="text-sm font-medium text-[#16345a]">My print sort</span>
      <div className="flex flex-wrap gap-1.5">
        {PRINT_SORT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={saving}
            aria-pressed={sort === key}
            onClick={async () => {
              if (sort === key) return;
              const previous = sort;
              setSort(key);
              setSaving(true);
              setError(null);
              const result = await setMyPrintSort(key);
              setSaving(false);
              if (!result.success) {
                setSort(previous);
                setError(result.error ?? "Couldn't save that.");
              }
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              sort === key ? "bg-[#163D6D] text-white" : "border border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {PRINT_SORT_LABELS[key]}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-500">
        {error ?? "Door lists and the attendee list print in this order for you."}
      </span>
    </section>
  );
}

interface WarRoomClientProps {
  conferenceId: string;
  initialRows: ConferencePerson[];
  canEditAdminNotes: boolean;
  whatsNext: WhatsNext | null;
  answers: ConferenceAnswer[];
  menus: WarRoomMenu[];
  asks: ConferenceAsk[];
}

export default function WarRoomClient({
  conferenceId,
  initialRows,
  canEditAdminNotes,
  whatsNext,
  answers,
  menus,
  asks,
}: WarRoomClientProps) {
  const [rows, setRows] = useState<ConferencePerson[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personKind, setPersonKind] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [badgeStatus, setBadgeStatus] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(Date.now());
  const [activeOpsTab, setActiveOpsTab] = useState<OpsTab>(whatsNext ? "whats_next" : "asks");
  const tabs = OPS_TABS.filter((tab) => !tab.adminOnly || whatsNext);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId]
  );
  const isStale = Date.now() - lastSuccessAt > STALE_MS;

  useEffect(() => {
    if (selected?.admin_notes !== undefined) {
      setNoteDraft(selected.admin_notes ?? "");
    }
  }, [selected?.id, selected?.admin_notes]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (personKind) params.set("person_kind", personKind);
    if (assignmentStatus) params.set("assignment_status", assignmentStatus);
    if (badgeStatus) params.set("badge_status", badgeStatus);
    if (checkIn) params.set("check_in", checkIn);
    const query = params.toString();
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/war-room${query ? `?${query}` : ""}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        rows?: ConferencePerson[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load data.");
      setRows(payload.rows ?? []);
      setError(null);
      setLastSuccessAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load war-room data.");
    } finally {
      setLoading(false);
    }
  }, [assignmentStatus, badgeStatus, checkIn, conferenceId, personKind, search]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const runPersonOp = async (
    personId: string,
    op: "update" | "manual_check_in" | "reprint_badge",
    patch?: Record<string, unknown>,
    reprintPayload?: {
      reprintReason: "damaged" | "lost" | "name_change" | "ops_override";
      reprintNote?: string | null;
    }
  ) => {
    const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op,
        patch,
        reprintReason: reprintPayload?.reprintReason,
        reprintNote: reprintPayload?.reprintNote ?? null,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operation failed.");
    await load();
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Operations</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveOpsTab(tab.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                activeOpsTab === tab.id
                  ? "border-accent bg-[#fff5f5] text-accent"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeOpsTab === "whats_next" && whatsNext ? (
        <WhatsNextView conferenceId={conferenceId} whatsNext={whatsNext} />
      ) : null}

      {activeOpsTab === "asks" ? (
        <AsksView conferenceId={conferenceId} asks={asks} canResolve={canEditAdminNotes} />
      ) : null}

      {activeOpsTab === "answers" ? (
        <AnswersView conferenceId={conferenceId} answers={answers} menus={menus} canEdit={canEditAdminNotes} />
      ) : null}

      {activeOpsTab === "people" ? (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold text-gray-900">Filters</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name/email/org"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={personKind}
                onChange={(e) => setPersonKind(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">All kinds</option>
                <option value="delegate">Delegate</option>
                <option value="exhibitor">Exhibitor</option>
                <option value="staff">Staff</option>
                <option value="unassigned">Unassigned</option>
              </select>
              <select
                value={assignmentStatus}
                onChange={(e) => setAssignmentStatus(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">All assignment states</option>
                <option value="assigned">Assigned</option>
                <option value="pending_user_activation">Pending Activation</option>
                <option value="unassigned">Unassigned</option>
                <option value="reassigned">Reassigned</option>
                <option value="canceled">Canceled</option>
              </select>
              <select
                value={badgeStatus}
                onChange={(e) => setBadgeStatus(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">All badge states</option>
                <option value="not_printed">Not Printed</option>
                <option value="printed">Printed</option>
                <option value="reprinted">Reprinted</option>
              </select>
              <select
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">All check-in states</option>
                <option value="checked_in">Checked In</option>
                <option value="not_checked_in">Not Checked In</option>
              </select>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
            {error ? <p className="mt-2 text-sm text-red-700">Degraded mode: {error}</p> : null}
            {isStale ? (
              <p className="mt-1 text-sm text-amber-700">
                Data is stale. Refresh before applying manual actions.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Master Table</h2>
              {loading ? <span className="text-xs text-gray-500">Refreshing…</span> : null}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Person</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Role</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Assignment</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Badge</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Check-in</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Travel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={6}>
                        No rows found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="px-3 py-2 text-gray-900">
                          {row.display_name ?? row.contact_email ?? row.id}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.person_kind}</td>
                        <td className="px-3 py-2 text-gray-700">{row.assignment_status}</td>
                        <td className="px-3 py-2 text-gray-700">{row.badge_print_status}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {row.checked_in_at ? "Checked In" : "Not Checked In"}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.travel_mode ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selected ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-base font-semibold text-gray-900">Detail Drawer</h2>
              <p className="mt-1 text-sm text-gray-600">
                {selected.display_name ?? selected.contact_email ?? selected.id}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 p-3 text-sm">
                  <p className="font-medium text-gray-900">Travel / Hotel</p>
                  <p className="mt-1 text-gray-700">Mode: {selected.travel_mode ?? "—"}</p>
                  <p className="text-gray-700">Hotel: {selected.hotel_name ?? "—"}</p>
                  <p className="text-gray-700">
                    Confirmation: {selected.hotel_confirmation_code ?? "—"}
                  </p>
                  <p className="text-gray-700">
                    Dietary: {selected.dietary_restrictions ? "Flagged" : "None"}
                  </p>
                  <p className="text-gray-700">
                    Accessibility: {selected.accessibility_needs ? "Flagged" : "None"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 p-3 text-sm">
                  <p className="font-medium text-gray-900">Quick Actions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isStale}
                      onClick={() => void runPersonOp(selected.id, "manual_check_in")}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Manual Check-in
                    </button>
                    <button
                      type="button"
                      disabled={isStale}
                      onClick={() => {
                        const reasonRaw = window.prompt(
                          "Reprint reason (damaged, lost, name_change, ops_override):",
                          "damaged"
                        );
                        if (!reasonRaw) return;
                        const reason = reasonRaw.trim().toLowerCase();
                        if (!["damaged", "lost", "name_change", "ops_override"].includes(reason)) {
                          return;
                        }
                        const note = window.prompt("Optional reprint note:", "") ?? "";
                        void runPersonOp(selected.id, "reprint_badge", undefined, {
                          reprintReason: reason as
                            | "damaged"
                            | "lost"
                            | "name_change"
                            | "ops_override",
                          reprintNote: note.trim().length > 0 ? note.trim() : null,
                        });
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reprint Badge
                    </button>
                  </div>
                  {canEditAdminNotes ? (
                    <>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                        rows={4}
                        placeholder="Admin notes"
                      />
                      <button
                        type="button"
                        disabled={isStale}
                        onClick={() =>
                          void runPersonOp(selected.id, "update", { admin_notes: noteDraft })
                        }
                        className="mt-2 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save Notes
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-gray-600">
                      Admin notes are visible/editable only to admin and super admin users.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

    </div>
  );
}

/**
 * Asks: what people need from us, kept in one place so none is dropped.
 *
 * Stephen, 2026-10-22: no owners — one shared list; anyone adds one, whoever
 * handles it ticks it off. Each is an ordinary site flag (see
 * loadConferenceAsks), so one raised with the toolkit on the desk lands here too.
 */
function AsksView({
  conferenceId,
  asks,
  canResolve,
}: {
  conferenceId: string;
  asks: ConferenceAsk[];
  canResolve: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = asks.filter((a) => a.status === "open" || a.status === "in_progress" || a.status === "acknowledged");
  const done = asks.filter((a) => !open.includes(a));

  async function add() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    const result = await submitFlag({
      pageUrl: `/admin/conference/${conferenceId}/war-room`,
      priority: urgent ? "high" : "normal",
      note: note.trim(),
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    setNote("");
    setUrgent(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What does someone need? e.g. Suite 12 needs a power bar"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            Urgent
          </label>
          <button
            type="submit"
            disabled={busy || !note.trim()}
            className="rounded-md bg-[#163D6D] px-3 py-2 text-xs font-semibold text-white hover:bg-[#12325a] disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open · {open.length}</h2>
        {open.length === 0 ? <p className="text-sm text-gray-500">Nothing waiting.</p> : null}
        {open.map((ask) => (
          <AskRow key={ask.id} ask={ask} canResolve={canResolve} />
        ))}
      </section>

      {done.length > 0 ? (
        <details>
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-gray-500">
            Done · {done.length}
          </summary>
          <div className="mt-2 space-y-2">
            {done.map((ask) => (
              <AskRow key={ask.id} ask={ask} canResolve={false} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function AskRow({ ask, canResolve }: { ask: ConferenceAsk; canResolve: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // "Ask CSC" from their own page, or raised by staff on one of ours.
  const page = ask.pageUrl.includes("war-room?ask=")
    ? "Ask CSC"
    : ask.pageUrl.split("/").slice(4).join("/").split("?")[0] || "war-room";
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white px-[18px] py-3 odd:bg-white/60">
      <div className="min-w-0">
        <p className="text-sm text-gray-900">
          {ask.priority === "high" ? (
            <span className="mr-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Urgent</span>
          ) : null}
          {ask.note || <span className="text-gray-500">(no note)</span>}
        </p>
        {ask.details ? (
          <p className="mt-1 whitespace-pre-line text-xs text-gray-600">{ask.details}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-gray-500">
          {ask.flaggerName ?? "Someone"} · {formatDayMonth(ask.createdAt, "America/Edmonton")}{" "}
          {new Date(ask.createdAt).toLocaleTimeString("en-CA", {
            timeZone: "America/Edmonton",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · from {page}
        </p>
      </div>
      {canResolve ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await resolveFlag(ask.id);
            setBusy(false);
            if (result.success) router.refresh();
          }}
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          {busy ? "…" : "Done"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Answers: what people ask, answered once in Build — the same list each person
 * sees on their own conference page — and tonight's menus.
 */
function AnswersView({
  conferenceId,
  answers,
  menus,
  canEdit,
}: {
  conferenceId: string;
  answers: ConferenceAnswer[];
  menus: WarRoomMenu[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15.5px] font-medium text-[#16345a]">Good to know</h2>
          {canEdit ? (
            <a href={`/admin/conference/${conferenceId}/build`} className="text-xs text-accent hover:underline">
              Add or edit in Build (kind: Answer)
            </a>
          ) : null}
        </div>
        {answers.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No answers yet. In Build, add a thing of kind &ldquo;Answer&rdquo; named as the question (Wi-Fi, Coat
            check), with the answer. It shows here and on everyone&apos;s own conference page.
          </p>
        ) : (
          <dl className="mt-2 divide-y divide-gray-100">
            {answers.map((a) => (
              <div key={a.id} className="py-2">
                <dt className="text-sm font-medium text-gray-900">
                  {a.question}
                  {a.where ? <span className="ml-2 font-normal text-gray-500">{a.where}</span> : null}
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-gray-700">{a.answer}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <h2 className="text-[15.5px] font-medium text-[#16345a]">Menus</h2>
        {menus.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No menus yet. Each meal in Build has a Menu field; it shows beside the meal on people&apos;s schedules.
          </p>
        ) : (
          <dl className="mt-2 divide-y divide-gray-100">
            {menus.map((m) => (
              <div key={m.id} className="py-2">
                <dt className="text-sm font-medium text-gray-900">
                  {m.title}
                  <span className="ml-2 font-normal text-gray-500">
                    {formatCalendarDate(m.dayKey) ?? m.dayKey}
                    {m.startTime ? `, ${m.startTime}` : ""}
                  </span>
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-gray-700">{m.menu}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

/**
 * Now, Next, Later, Done — what needs doing surfaces, what's finished folds away.
 *
 * Stephen, 2026-10-22: the look of /admin/membership, the behaviour of the
 * /admin widgets. Each checklist is a card; its tasks are the same tick-off
 * list org admins and attendees answer (TaskChecklist), here answered by CSC
 * for the conference.
 */
function WhatsNextView({ conferenceId, whatsNext }: { conferenceId: string; whatsNext: WhatsNext }) {
  const { groups } = whatsNext;
  const open = groups.now.length + groups.next.length + groups.later.length;

  if (open + groups.done.length === 0) {
    return (
      <div className="space-y-6">
      <MyPrintSort initial={whatsNext.printSort} />
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Nothing on the run-sheet yet</h2>
        <p className="mt-1 text-sm text-gray-600">
          What&apos;s next is built from checklists answered by CSC staff. Add one under{" "}
          <a href={`/admin/conference/${conferenceId}/checklists`} className="text-accent hover:underline">
            Checklists
          </a>{" "}
          and set its tasks to &ldquo;CSC staff, in the War Room&rdquo;.
        </p>
      </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MyPrintSort initial={whatsNext.printSort} />
      {groups.now.length > 0 ? (
        <ChecklistGroup title="Now" lists={groups.now} whatsNext={whatsNext} conferenceId={conferenceId} />
      ) : null}
      {groups.next.length > 0 ? (
        <ChecklistGroup title="Next" lists={groups.next} whatsNext={whatsNext} conferenceId={conferenceId} />
      ) : null}
      {groups.later.length > 0 ? (
        <ChecklistGroup title="Later" lists={groups.later} whatsNext={whatsNext} conferenceId={conferenceId} folded />
      ) : null}
      {groups.done.length > 0 ? (
        <ChecklistGroup title="Done" lists={groups.done} whatsNext={whatsNext} conferenceId={conferenceId} folded />
      ) : null}
      <p className="text-xs text-gray-500">
        These are the conference&apos;s{" "}
        <a href={`/admin/conference/${conferenceId}/checklists`} className="text-accent hover:underline">
          checklists
        </a>{" "}
        answered by CSC staff. Edit them there.
      </p>
    </div>
  );
}

function ChecklistGroup({
  title,
  lists,
  whatsNext,
  conferenceId,
  folded = false,
}: {
  title: string;
  lists: StaffChecklist[];
  whatsNext: WhatsNext;
  conferenceId: string;
  folded?: boolean;
}) {
  const cards = (
    <div className="space-y-4">
      {lists.map((list) => (
        <StaffChecklistCard key={list.id} list={list} whatsNext={whatsNext} conferenceId={conferenceId} />
      ))}
    </div>
  );
  const heading = (
    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {title} · {lists.length}
    </span>
  );
  if (folded) {
    return (
      <details className="group">
        <summary className="cursor-pointer list-none">{heading}</summary>
        <div className="mt-3">{cards}</div>
      </details>
    );
  }
  return (
    <section className="space-y-3">
      <h2>{heading}</h2>
      {cards}
    </section>
  );
}

function StaffChecklistCard({
  list,
  whatsNext,
  conferenceId,
}: {
  list: StaffChecklist;
  whatsNext: WhatsNext;
  conferenceId: string;
}) {
  const answered = list.tasks.filter((t) => t.state !== "pending").length;
  const when = formatDayMonth(list.deadline, whatsNext.timeZone);
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-medium leading-tight text-[#16345a]">{list.name}</h3>
          {list.description ? <p className="mt-0.5 text-[12.5px] text-gray-500">{list.description}</p> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {when ? <span>{when}</span> : null}
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              answered === list.tasks.length ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
            }`}
          >
            {answered} of {list.tasks.length}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <TaskChecklist
          tasks={list.tasks}
          controlsByTaskId={whatsNext.controlsByTaskId}
          onAnswer={async (taskId, state, evidence) => {
            if (!whatsNext.answeringOrgId) {
              return { success: false, error: "CSC's own organization record is missing, so a tick has nowhere to go." };
            }
            return answerOrgTask({
              organizationId: whatsNext.answeringOrgId,
              conferenceId,
              taskId,
              state,
              evidence,
            });
          }}
        />
      </div>
    </section>
  );
}
