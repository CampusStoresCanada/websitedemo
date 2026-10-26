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
import { resolveFlag } from "@/lib/actions/flags";
import { decideSwapCapIncreaseRequest } from "@/lib/actions/conference-swaps";
import { setBursaryApplicationStatus } from "@/lib/actions/conference-bursary";
import type { WaitingItem, WaitingOnUs } from "@/lib/conference/waiting-on-us";
import { PRINT_SORT_KEYS, type PrintSortKey } from "@/lib/conference/badges/arrangement";
import { setMyPrintSort } from "@/lib/actions/profile";
import {
  advanceBadgePrintJob,
  createPreprintedBadgeJob,
  deleteBadgePrintJob,
  loadPrintOverview,
  loadReprintPreview,
  sendDocumentToPrinter,
  type PrintOverview,
  type ReprintPreview,
} from "@/lib/actions/conference-badges";
import { exportConferenceRoster, printBadge, type RosterExport } from "@/lib/actions/conference-people";
import {
  createSchedulerDraftRun,
  emailActiveSchedule,
  loadMeetingsOverview,
  promoteSchedulerRun,
  type MeetingsOverview,
} from "@/lib/actions/conference-scheduler";
import MeetingMatrix from "@/components/admin/conference/MeetingMatrix";
import CampaignPreviewButton from "@/components/comms/CampaignPreviewButton";
import { runConferenceRemindersNow } from "@/lib/actions/conference-checklists";
import type { ChecklistRunResult } from "@/lib/conference/checklist-engine";
import { updateField } from "@/lib/actions/update-field";
import { cardChoices, type BadgeStock } from "@/lib/conference/badges/reprint-plan";
import ConfirmAction from "@/components/ui/ConfirmAction";
import Modal from "@/components/ui/Modal";
import OperateRow from "@/components/ui/OperateRow";

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

export type OpsTab = "waiting" | "whats_next" | "print" | "meetings" | "messages" | "people" | "data" | "answers";

/** The War Room's tabs (WAR_ROOM_OPERATE_PLAN §5). */
const OPS_TABS: Array<{ id: OpsTab; label: string }> = [
  { id: "waiting", label: "Waiting on us" },
  { id: "whats_next", label: "What's next" },
  { id: "print", label: "Print" },
  { id: "meetings", label: "Meetings" },
  { id: "messages", label: "Messages" },
  { id: "people", label: "People" },
  { id: "data", label: "Data" },
  { id: "answers", label: "Answers" },
];

function isOpsTab(value: string | null): value is OpsTab {
  return OPS_TABS.some((tab) => tab.id === value);
}

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

/**
 * Personal settings, out of the way of the work: set once, rarely revisited.
 * Print sort used to sit above What's next, ahead of everything to do.
 */
export function MeMenu({ printSort }: { printSort: PrintSortKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Me ▾
      </button>
      {open ? (
        <>
          {/* Click anywhere else to close. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            <MyPrintSort initial={printSort} />
          </div>
        </>
      ) : null}
    </div>
  );
}

interface WarRoomClientProps {
  conferenceId: string;
  initialRows: ConferencePerson[];
  whatsNext: WhatsNext;
  answers: ConferenceAnswer[];
  menus: WarRoomMenu[];
  /** Everyone waiting on CSC (loadWaitingOnUs). */
  waiting: WaitingOnUs;
  /** `?tab=` from the address, unchecked (the status line links to tabs). */
  requestedTab: string | null;
  /** Rebuilds the people index — the only tab it affects is People. */
  syncPeopleIndex: () => Promise<void>;
  printStation: PrintStationState;
  messages: WarRoomMessages;
  dataCounts: WarRoomDataCounts;
  /**
   * Admins work the War Room; sending email to members and downloading their
   * personal data stay super-admin acts, and the rows say so.
   */
  superAdmin: boolean;
  /** Comms' own send, checked for CSC staff and this conference by the page. */
  sendCampaign: (campaignId: string) => Promise<{ success: boolean; error?: string }>;
}

export default function WarRoomClient({
  conferenceId,
  initialRows,
  whatsNext,
  answers,
  menus,
  waiting,
  requestedTab,
  syncPeopleIndex,
  printStation,
  messages,
  dataCounts,
  superAdmin,
  sendCampaign,
}: WarRoomClientProps) {
  // The War Room is administrators only now (WAR_ROOM_OPERATE_PLAN §2).
  const canEditAdminNotes = true;
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
  const [reprintPerson, setReprintPerson] = useState<{ id: string; name: string | null } | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(Date.now());
  const waitingCount = waiting.items.length;
  const anyUrgent = waiting.items.some((item) => item.urgent);
  // A tab the address names; otherwise whatever has someone waiting, then the
  // run-sheet.
  const [activeOpsTab, setActiveOpsTabState] = useState<OpsTab>(
    isOpsTab(requestedTab) ? requestedTab : waitingCount > 0 ? "waiting" : "whats_next"
  );
  // In the address so the status line can link straight to a tab, and a
  // refresh lands where you were.
  const setActiveOpsTab = (tab: OpsTab) => {
    setActiveOpsTabState(tab);
    window.history.replaceState(null, "", `?tab=${tab}`);
  };

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

  // Only while People is open: polling a roster nobody is looking at is load
  // for nothing.
  const peopleOpen = activeOpsTab === "people";
  useEffect(() => {
    if (!peopleOpen) return;
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load, peopleOpen]);

  const runPersonOp = async (personId: string, op: "update" | "manual_check_in", patch?: Record<string, unknown>) => {
    const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, patch }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operation failed.");
    await load();
  };

  return (
    <div className="space-y-5">
      {/* The page's main control, not a card around buttons. */}
      <nav className="-mx-4 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:px-0" aria-label="War Room">
        <div className="flex gap-5">
          {OPS_TABS.map((tab) => {
            const active = activeOpsTab === tab.id;
            const count = tab.id === "waiting" ? waitingCount : 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveOpsTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-sm font-medium ${
                  active ? "border-accent text-accent" : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {tab.label}
                {count > 0 ? (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      anyUrgent ? "bg-red-600 text-white" : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {activeOpsTab === "whats_next" ? (
        <WhatsNextView conferenceId={conferenceId} whatsNext={whatsNext} />
      ) : null}

      {activeOpsTab === "waiting" ? (
        <WaitingView conferenceId={conferenceId} waiting={waiting} />
      ) : null}

      {activeOpsTab === "meetings" ? <MeetingsView conferenceId={conferenceId} /> : null}

      {activeOpsTab === "data" ? <DataView conferenceId={conferenceId} counts={dataCounts} canExport={superAdmin} /> : null}

      {activeOpsTab === "messages" ? (
        <MessagesView conferenceId={conferenceId} messages={messages} sendCampaign={sendCampaign} canSend={superAdmin} />
      ) : null}

      {activeOpsTab === "print" ? (
        <PrintView conferenceId={conferenceId} people={initialRows} station={printStation} />
      ) : null}

      {reprintPerson ? (
        <ReprintModal
          key={reprintPerson.id}
          conferenceId={conferenceId}
          people={initialRows}
          person={reprintPerson}
          onClose={() => {
            setReprintPerson(null);
            void load();
          }}
        />
      ) : null}

      {activeOpsTab === "answers" ? (
        <AnswersView conferenceId={conferenceId} answers={answers} menus={menus} canEdit={canEditAdminNotes} />
      ) : null}

      {activeOpsTab === "people" ? (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">Filters</h2>
              {/* Moved from the War Room's header: People is the only thing it touches. */}
              <ConfirmAction
                label="Sync People Index"
                consequence="Rebuilds this conference's people list from registrations and seats. Nobody is emailed."
                onConfirm={async () => {
                  await syncPeopleIndex();
                  await load();
                }}
              />
            </div>
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
                    <ConfirmAction
                      label="Check in by hand"
                      consequence={`Records ${selected.display_name ?? "this person"} as checked in now, without a scan.`}
                      disabled={isStale}
                      onConfirm={async () => {
                        try {
                          await runPersonOp(selected.id, "manual_check_in");
                          return { success: true };
                        } catch (err) {
                          return { success: false, error: err instanceof Error ? err.message : "Couldn't check them in." };
                        }
                      }}
                    />
                    {/* The Print tab's reprint, for this person. */}
                    <button
                      type="button"
                      onClick={() => setReprintPerson({ id: selected.id, name: selected.display_name })}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Reprint badge…
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
 * Waiting on us: everyone waiting on CSC, in one list (loadWaitingOnUs) — asks,
 * extra meeting swaps, bursary decisions. Urgent first, then longest waiting.
 *
 * Stephen, 2026-10-22: no owners — anyone adds an ask, whoever handles it ticks
 * it off. Every action here is asked twice and says what it does.
 */
function WaitingView({
  conferenceId,
  waiting,
}: {
  conferenceId: string;
  waiting: WaitingOnUs;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const { items, doneAsks } = waiting;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-center gap-2">
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
          {/* Adding one messages CSC staff in Circle, so it is asked twice. */}
          <ConfirmAction
            label="Add"
            disabled={!note.trim()}
            consequence={`Adds this to the list and messages CSC staff in Circle${urgent ? ", marked urgent" : ""}.`}
            onConfirm={async () => {
              const result = await submitFlag({
                pageUrl: `/admin/conference/${conferenceId}/war-room`,
                priority: urgent ? "high" : "normal",
                note: note.trim(),
              });
              if (!result.success) return { success: false, error: result.error ?? "Couldn't save that." };
              setNote("");
              setUrgent(false);
              router.refresh();
              return { success: true };
            }}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Waiting · {items.length}</h2>
        {items.length === 0 ? <p className="text-sm text-gray-500">Nobody is waiting on us.</p> : null}
        {items.map((item) => (
          <WaitingRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </section>

      {doneAsks.length > 0 ? (
        <details>
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-gray-500">
            Handled asks · {doneAsks.length}
          </summary>
          <div className="mt-2 space-y-2">
            {doneAsks.map((ask) => (
              <div key={ask.id} className="rounded-xl border border-gray-200 bg-white px-[18px] py-3 text-sm text-gray-600">
                {ask.note || "(no note)"}
                <span className="ml-2 text-xs text-gray-400">
                  {ask.flaggerName ?? "Someone"} · {whenMountain(ask.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** A moment, in the operator's zone (Mountain): "22 October 2:04 p.m.". */
function whenMountain(iso: string): string {
  return `${formatDayMonth(iso, "America/Edmonton") ?? ""} ${new Date(iso).toLocaleTimeString("en-CA", {
    timeZone: "America/Edmonton",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

const KIND_LABEL: Record<WaitingItem["kind"], string> = {
  ask: "Ask",
  swap_cap: "Meeting swaps",
  bursary: "Travel bursary",
};

/** One person waiting, and the actions that answer them. */
function WaitingRow({ item }: { item: WaitingItem }) {
  const router = useRouter();
  const name = item.who ?? "Someone";
  const after = (result: { success: boolean; error?: string }) => {
    if (result.success) router.refresh();
    return result;
  };

  const actions =
    item.kind === "ask" ? (
      <ConfirmAction
        label="Done"
        consequence={`Marks ${name}'s ask as handled. Reply to them in Circle first if they need an answer.`}
        onConfirm={async () => after(await resolveFlag(item.id))}
      />
    ) : item.kind === "swap_cap" ? (
      <>
        <ConfirmAction
          label="Approve"
          consequence={`Gives ${name} ${item.extraSwaps ?? "the"} more meeting swap${item.extraSwaps === 1 ? "" : "s"}. They can use them on their own page straight away.`}
          onConfirm={async () => after(await decideSwapCapIncreaseRequest(item.id, "approved"))}
        />
        <ConfirmAction
          label="Deny"
          tone="danger"
          consequence={`Declines ${name}'s request for more swaps. Their current schedule stays as it is.`}
          onConfirm={async () => after(await decideSwapCapIncreaseRequest(item.id, "denied"))}
        />
      </>
    ) : (
      <>
        <ConfirmAction
          label="Approve"
          consequence={`Records the travel bursary for ${item.org ?? name} as approved. No email is sent.`}
          onConfirm={async () => after(await setBursaryApplicationStatus({ applicationId: item.id, status: "approved" }))}
        />
        <ConfirmAction
          label="Decline"
          tone="danger"
          consequence={`Records the travel bursary for ${item.org ?? name} as declined. No email is sent.`}
          onConfirm={async () => after(await setBursaryApplicationStatus({ applicationId: item.id, status: "denied" }))}
        />
      </>
    );

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white px-[18px] py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          {item.urgent ? (
            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">Urgent</span>
          ) : null}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">{KIND_LABEL[item.kind]}</span>
          <span className="font-medium text-gray-800">{name}</span>
          {item.org ? <span>{item.org}</span> : null}
          <span>· {whenMountain(item.since)}</span>
          {item.source ? <span>· from {item.source}</span> : null}
        </p>
        <p className="mt-1 text-sm text-gray-900">{item.what}</p>
        {item.details ? <p className="mt-1 whitespace-pre-line text-xs text-gray-600">{item.details}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2">{actions}</div>
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
function DataView({
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

/** "1 meeting", "3 meetings", "2 people". */
function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : word === "person" ? "people" : `${word}s`}`;
}

/** This conference's messages, as the page read them from Comms. */
export type WarRoomMessages = {
  broadcasts: Array<{
    id: string;
    name: string;
    status: string;
    /** Scheduled for, sent, or created (ISO). */
    when: string;
    delivered: number;
    /** Who a draft or scheduled campaign reaches now; null once sent. */
    recipients: number | null;
    preview: { subject: string; bodyHtml: string; variableKeys: string[]; variableValues: Record<string, string>; isTransactional: boolean };
  }>;
  /** Emails that fire on events, by template. */
  automatic: Array<{ key: string; name: string; templateId: string | null; sent: number; last: string | null }>;
  /** When checklist reminders last went to this conference (ISO). */
  lastReminder: string | null;
};

const CAMPAIGN_STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Sent",
  failed: "Failed",
  canceled: "Cancelled",
};

/**
 * Messages (WAR_ROOM_OPERATE_PLAN §5): this conference's email, in context.
 * Comms stays where messages are written, sent and tracked; Edit goes there,
 * and every send here goes through Comms' own send.
 */
function MessagesView({
  conferenceId,
  messages,
  sendCampaign,
  canSend,
}: {
  conferenceId: string;
  messages: WarRoomMessages;
  sendCampaign: (campaignId: string) => Promise<{ success: boolean; error?: string }>;
  /** Email to members goes only with a super admin; others see what there is. */
  canSend: boolean;
}) {
  const [reminders, setReminders] = useState<ChecklistRunResult | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [remindersSent, setRemindersSent] = useState<string | null>(null);
  const router = useRouter();

  // The dry run is the count and the preview: who would get what, nothing sent.
  const checkReminders = useCallback(async () => {
    const res = await runConferenceRemindersNow(conferenceId, { dryRun: true });
    if (res.success) setReminders(res.data);
    else setReminderError(res.error);
  }, [conferenceId]);
  useEffect(() => {
    if (!canSend) return;
    let live = true;
    void runConferenceRemindersNow(conferenceId, { dryRun: true }).then((res) => {
      if (!live) return;
      if (res.success) setReminders(res.data);
      else setReminderError(res.error);
    });
    return () => {
      live = false;
    };
  }, [conferenceId, canSend]);

  const due = reminders?.preview ?? [];
  const reminderState = !canSend
    ? `Only a super admin can check or send reminders${
        messages.lastReminder ? ` (last sent ${whenMountain(messages.lastReminder)})` : ""
      }.`
    : reminderError
    ? reminderError
    : !reminders
      ? "Working out who is due a reminder (about half a minute)…"
      : `${due.length === 0 ? "Nobody is due a reminder today" : `${plural(due.length, "organization")} due a reminder`}${
          messages.lastReminder ? ` (last sent ${whenMountain(messages.lastReminder)})` : ""
        }.${remindersSent ? ` ${remindersSent}` : ""}`;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Reminders</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Checklist reminders"
            state={`${reminderState} They also go out on their own every business day.`}
            tone={reminderError ? "blocked" : due.length > 0 ? "attention" : "neutral"}
            edit={{ href: `/admin/conference/${conferenceId}/checklists`, label: "Checklists" }}
            preview={
              due.length > 0
                ? {
                    title: "Who would get a reminder",
                    content: (
                      <ul className="divide-y divide-gray-100 text-sm">
                        {due.map((org) => (
                          <li key={org.organizationId} className="py-2">
                            <p className="font-medium text-gray-900">{org.organization}</p>
                            <p className="text-xs text-gray-500">{org.recipients.join(", ")}</p>
                            <p className="mt-0.5 text-xs text-gray-700">{org.items.join(" · ")}</p>
                          </li>
                        ))}
                      </ul>
                    ),
                  }
                : null
            }
            action={
              due.length > 0
                ? {
                    label: "Send now",
                    consequence: `Emails the admins of ${plural(due.length, "organization")} what they still owe for this conference. Anyone already reminded at this point is skipped.`,
                    onConfirm: async () => {
                      const res = await runConferenceRemindersNow(conferenceId);
                      if (!res.success) return res;
                      setRemindersSent(
                        res.data.errors.length > 0
                          ? `Sent to ${plural(res.data.orgsReminded, "organization")}; ${res.data.errors[0]}`
                          : `Sent to ${plural(res.data.orgsReminded, "organization")}.`
                      );
                      await checkReminders();
                      router.refresh();
                      return { success: true };
                    },
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Campaigns</h3>
          <a
            href={`/admin/comms/new?conference_id=${conferenceId}`}
            className="text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            New campaign in Comms ▸
          </a>
        </div>
        {messages.broadcasts.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">No campaigns for this conference yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {messages.broadcasts.map((c) => {
              const pending = c.status === "draft" || c.status === "scheduled";
              return (
                <OperateRow
                  key={c.id}
                  title={c.name}
                  state={`${CAMPAIGN_STATUS_WORDS[c.status] ?? c.status} ${whenMountain(c.when)}${
                    pending && c.recipients !== null ? ` · reaches ${plural(c.recipients, "person")}` : ""
                  }${!pending && c.delivered > 0 ? ` · ${plural(c.delivered, "email")}` : ""}.`}
                  tone={c.status === "failed" ? "blocked" : pending ? "attention" : "neutral"}
                  edit={{ href: `/admin/comms/${c.id}`, label: "Comms" }}
                  extra={
                    c.preview.bodyHtml || c.preview.subject ? (
                      <CampaignPreviewButton
                        bodyHtml={c.preview.bodyHtml}
                        subject={c.preview.subject}
                        variableKeys={c.preview.variableKeys}
                        variableValues={c.preview.variableValues}
                        isTransactional={c.preview.isTransactional}
                        compact
                      />
                    ) : null
                  }
                  action={
                    canSend && pending && c.recipients !== null && c.recipients > 0
                      ? {
                          label: "Send now",
                          consequence: `Emails ${plural(c.recipients, "person")} now${
                            c.status === "scheduled" ? ", instead of at the scheduled time" : ""
                          }.`,
                          onConfirm: async () => {
                            const res = await sendCampaign(c.id);
                            if (res.success) router.refresh();
                            return res;
                          },
                        }
                      : null
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4 pb-2">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Automatic emails</h3>
        <p className="text-xs text-gray-500">They go out on their own when something happens. Edit the wording in Comms.</p>
        {messages.automatic.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">None have gone out for this conference yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {messages.automatic.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{a.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {plural(a.sent, "email")}
                    {a.last ? `, last ${whenMountain(a.last)}` : ""}
                  </span>
                </div>
                {a.templateId ? (
                  <a
                    href={`/admin/comms/templates/${a.templateId}`}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Edit
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What a scheduler run's diagnostics say, in an operator's words. */
const FINDING_WORDS: Record<string, string> = {
  BLACKOUT: "Put someone in a meeting with an organization they refused",
  DUPLICATE_EXHIBITOR_ORG: "Gave someone two meetings with the same company",
  GROUP_BOUNDS: "Made a meeting larger or smaller than allowed",
  EXHIBITOR_TARGET: "Exhibitors below their target number of meetings",
  DELEGATE_TARGET: "Delegates below their target number of meetings",
  DELEGATE_SELF_EXCLUDED: "Delegates who refused every exhibitor, so had no one to meet",
  DELEGATE_DOUBLE_BOOKED: "Put someone in two meetings at the same time",
  ORG_COVERAGE: "Organizations with no meetings at all",
  PERSON_COVERAGE: "People with no meetings at all",
  EXHIBITOR_WITHOUT_SUITE: "Exhibitors with no suite, so no meetings",
  POLICY_RELAXATION_DISABLED: "Could not loosen the rules to fit more in (turned off)",
};
const SEVERITY_WORDS: Record<string, string> = { hard: "Stops the draft", soft: "Warning", info: "Note" };

type RunFinding = { code: string; severity: string; text: string; count: number };

function runFindings(diagnostics: unknown): { placed: number | null; findings: RunFinding[] } {
  const d = (diagnostics ?? {}) as { totalAssignments?: number; violations?: Array<Record<string, unknown>> };
  const byCode = new Map<string, RunFinding>();
  for (const v of d.violations ?? []) {
    const code = String(v.code ?? "UNKNOWN");
    const details = (v.details ?? {}) as Record<string, unknown>;
    const ids = [details.exhibitorSeatIds, details.delegateSeatIds].find(Array.isArray) as unknown[] | undefined;
    const entry = byCode.get(code) ?? {
      code,
      severity: String(v.severity ?? "info"),
      text: FINDING_WORDS[code] ?? String(v.message ?? code),
      count: 0,
    };
    entry.count += ids ? ids.length : 1;
    byCode.set(code, entry);
  }
  const order = { hard: 0, soft: 1, info: 2 } as Record<string, number>;
  return {
    placed: typeof d.totalAssignments === "number" ? d.totalAssignments : null,
    findings: [...byCode.values()].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3)),
  };
}

/**
 * A run's findings as sentences, worst first. A failed (infeasible) draft
 * keeps its meetings for the grid but can never be published.
 */
function DraftFindings({ diagnostics, broken }: { diagnostics: unknown; broken: boolean }) {
  const { placed, findings } = runFindings(diagnostics);
  return (
    <div className="space-y-3 text-sm text-gray-700">
      {placed !== null ? (
        <p>
          It placed {plural(placed, "meeting")}.
          {broken ? " They are saved, so you can see them in the grid, but this draft can't be published." : ""}
        </p>
      ) : null}
      <ul className="divide-y divide-gray-100">
        {findings.map((f) => (
          <li key={f.code} className="flex items-baseline justify-between gap-3 py-1.5">
            <span>
              <span
                className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  f.severity === "hard" ? "bg-red-50 text-red-700" : f.severity === "soft" ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-600"
                }`}
              >
                {SEVERITY_WORDS[f.severity] ?? f.severity}
              </span>
              {f.text}
            </span>
            {f.count > 1 ? <span className="shrink-0 text-xs text-gray-500">{f.count}</span> : null}
          </li>
        ))}
      </ul>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">The run&apos;s full report</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-gray-800">
          {JSON.stringify(diagnostics ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const RUN_STATUS_WORDS: Record<string, string> = {
  running: "still running",
  completed: "ready",
  failed: "failed",
  infeasible: "could not fit everyone",
};

/**
 * Meetings (WAR_ROOM_OPERATE_PLAN §5): carry out the meeting schedule. The
 * Schedule page defines days, suites and cadence; everything that makes,
 * publishes, sends or changes the meetings themselves is here. Schedule Ops,
 * which did this before, is gone.
 */
function MeetingsView({ conferenceId }: { conferenceId: string }) {
  const [overview, setOverview] = useState<MeetingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = async () => {
    const res = await loadMeetingsOverview(conferenceId);
    if (res.success) {
      setOverview(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  };
  useEffect(() => {
    let live = true;
    void loadMeetingsOverview(conferenceId).then((res) => {
      if (!live) return;
      if (res.success) setOverview(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [conferenceId]);

  if (!overview) {
    return <p className={`text-sm ${error ? "text-red-700" : "text-gray-500"}`}>{error ?? "Loading the meetings…"}</p>;
  }

  const base = `/admin/conference/${conferenceId}`;
  const { live, draft, email, meetings, canPublish } = overview;
  // Publishing and emailing stay super-admin acts on the server; an admin sees why.
  const superOnly = "Only a super admin can do this.";
  const draftReady = draft?.status === "completed";
  const draftBroken = draft?.status === "failed" || draft?.status === "infeasible";

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">The schedule</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Generate a draft"
            state={
              draft
                ? `Newest draft ${whenMountain(draft.startedAt)}: ${RUN_STATUS_WORDS[draft.status] ?? draft.status}${
                    draftReady ? `, ${plural(draft.meetings, "meeting")}` : ""
                  }.`
                : "No draft yet."
            }
            tone={draftBroken ? "blocked" : "neutral"}
            edit={{ href: `${base}/schedule`, label: "Days & suites" }}
            preview={
              draft && runFindings(draft.diagnostics).findings.length > 0
                ? {
                    title: draftBroken ? "Why the draft failed" : "What the draft could not do",
                    content: <DraftFindings diagnostics={draft.diagnostics} broken={draftBroken} />,
                  }
                : null
            }
            action={{
              label: "Generate",
              consequence: "Builds a new draft from today's seats and requests. The live schedule does not change.",
              onConfirm: async () => {
                const res = await createSchedulerDraftRun(conferenceId);
                await load();
                return res.success ? { success: true } : { success: false, error: res.error };
              },
            }}
          />
          <OperateRow
            title="Publish the schedule"
            state={
              !draftReady
                ? live
                  ? `Live: ${plural(live.meetings, "meeting")} for ${plural(live.people, "person")}. No new draft to publish.`
                  : "Nothing to publish: generate a draft first."
                : `${draft.changes.length === 0 ? "No changes" : plural(draft.changes.length, "change")} against ${
                    live ? `the live schedule (${plural(live.meetings, "meeting")})` : "nothing: nothing is live yet"
                  }.${canPublish ? "" : ` ${superOnly}`}`
            }
            tone={draftReady && draft.changes.length > 0 ? "attention" : "neutral"}
            preview={
              draftReady
                ? {
                    title: "What publishing changes",
                    content:
                      draft.changes.length === 0 ? (
                        <p className="text-sm text-gray-600">The draft is the same as the live schedule.</p>
                      ) : (
                        <table className="min-w-full divide-y divide-gray-200 text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="py-1.5 pr-3 font-medium">When</th>
                              <th className="py-1.5 pr-3 font-medium">Suite</th>
                              <th className="py-1.5 pr-3 font-medium">Now</th>
                              <th className="py-1.5 font-medium">After</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-700">
                            {draft.changes.map((row) => (
                              <tr key={row.slotId}>
                                <td className="py-1.5 pr-3 whitespace-nowrap">
                                  Day {row.dayNumber}, {row.startTime.slice(0, 5)}
                                </td>
                                <td className="py-1.5 pr-3">{row.suiteNumber ?? "—"}</td>
                                <td className="py-1.5 pr-3">{row.live}</td>
                                <td className="py-1.5">{row.draft}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ),
                  }
                : null
            }
            action={
              draftReady && canPublish && (draft.changes.length > 0 || !live)
                ? {
                    label: "Publish",
                    consequence: `Makes this draft the live schedule: ${plural(draft.meetings, "meeting")}.${
                      live && live.handEdits > 0 ? ` The ${plural(live.handEdits, "hand edit")} in the live schedule are lost.` : ""
                    } Nobody is emailed until you send it.`,
                    onConfirm: async () => {
                      const res = await promoteSchedulerRun(conferenceId, draft.runId);
                      await load();
                      return res.success ? { success: true } : { success: false, error: res.error };
                    },
                  }
                : null
            }
          />
          <OperateRow
            title="Email everyone their schedule"
            state={
              !email
                ? "Nothing is live to send."
                : `${email.toSend.length === 0 ? "Everyone has been told" : `${plural(email.toSend.length, "person")} to tell`}${
                    email.alreadyTold ? `, ${email.alreadyTold} already told` : ""
                  }${email.noEmail ? `, ${email.noEmail} with no email address` : ""}.${canPublish ? "" : ` ${superOnly}`}${
                    sent ? ` ${sent}` : ""
                  }`
            }
            tone={email && email.noEmail > 0 ? "attention" : "neutral"}
            edit={email?.templateId ? { href: `/admin/comms/templates/${email.templateId}`, label: "Email" } : null}
            preview={
              email
                ? {
                    title: "Email everyone their schedule",
                    content: (
                      <div className="space-y-4 text-sm">
                        {email.sample ? (
                          <div className="rounded-lg border border-gray-200">
                            <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-600">
                              <p>To: {email.sample.to}</p>
                              <p className="font-medium text-gray-900">{email.sample.subject}</p>
                            </div>
                            {/* Sandboxed: the template's own HTML, nothing of the page's. */}
                            <iframe sandbox="" srcDoc={email.sample.bodyHtml} title="The email" className="h-80 w-full border-0" />
                          </div>
                        ) : (
                          <p className="text-gray-600">The schedule-ready email template is missing.</p>
                        )}
                        {email.toSend.length > 0 ? (
                          <div>
                            <p className="font-medium text-gray-900">Who it goes to</p>
                            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-xs text-gray-700">
                              {email.toSend.map((person) => (
                                <li key={person.email} className="flex justify-between gap-3">
                                  <span className="truncate">
                                    {person.name} · {person.orgName}
                                  </span>
                                  <span className="shrink-0 text-gray-500">{plural(person.meetingCount, "meeting")}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ),
                  }
                : null
            }
            action={
              email && canPublish && email.toSend.length > 0
                ? {
                    label: "Send",
                    consequence: `Emails ${plural(email.toSend.length, "person")} that their meetings are ready. Anyone already told about this schedule is skipped.`,
                    onConfirm: async () => {
                      const res = await emailActiveSchedule(conferenceId);
                      if (!res.success) return res;
                      setSent(`Sent to ${plural(res.data.sent, "person")}.`);
                      await load();
                      return { success: true };
                    },
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">On the day</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="The meeting grid"
            state={
              live
                ? `${plural(live.meetings, "meeting")} live${live.handEdits ? `, ${plural(live.handEdits, "hand edit")}` : ""}. Open a meeting to change or cancel it.`
                : draftReady
                  ? "Showing the draft: nothing is live yet."
                  : "No meetings yet."
            }
            extra={
              <button
                type="button"
                onClick={() => setGridOpen(true)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open the grid
              </button>
            }
          />
          <OperateRow
            title="Meetings confirmed"
            state={
              !meetings || meetings.total === 0
                ? "No meetings in the live schedule."
                : meetings.started === 0
                  ? `None have started. The first is ${meetings.firstStartsLocal ?? "not timed"}.`
                  : `${meetings.confirmed} of ${meetings.started} started meetings confirmed by a check-in card.`
            }
            tone={meetings && meetings.unconfirmed.length > 0 ? "attention" : "neutral"}
            preview={
              meetings && meetings.unconfirmed.length > 0
                ? {
                    title: "Started, not confirmed",
                    content: (
                      <ul className="divide-y divide-gray-100 text-sm text-gray-700">
                        {meetings.unconfirmed.map((m) => (
                          <li key={m.scheduleId} className="flex justify-between gap-3 py-1.5">
                            <span>{m.exhibitorName}</span>
                            <span className="text-xs text-gray-500">
                              {m.startsAtLocal}
                              {m.suiteNumber ? ` · Suite ${m.suiteNumber}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ),
                  }
                : null
            }
          />
        </div>
      </section>

      {gridOpen ? (
        <Modal open onClose={() => setGridOpen(false)} title="The meeting grid" size="full">
          <div className="p-3">
            <MeetingMatrix conferenceId={conferenceId} data={overview.matrix} onChanged={() => void load()} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** The print station, as the page already read it for the status line. */
export type PrintStationState = { stations: number; online: boolean; queued: number };

const JOB_STATUS_WORDS: Record<string, string> = {
  queued: "Being made",
  rendering: "Being made",
  rendered: "Being made",
  pdf_generated: "File ready",
  sent_to_printer: "At the print station",
  printed: "Printed",
  delivered: "Delivered",
  failed: "Failed",
  canceled: "Cancelled",
};

/**
 * Print (WAR_ROOM_OPERATE_PLAN §5): everything CSC produces on paper, as rows.
 * Badge Ops keeps the design; making the package happens here. A one-off badge
 * goes through the one print engine (printBadge), the desk's own.
 */
function PrintView({
  conferenceId,
  people,
  station,
}: {
  conferenceId: string;
  people: ConferencePerson[];
  station: PrintStationState;
}) {
  const [overview, setOverview] = useState<PrintOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeBlanks, setIncludeBlanks] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [doorEntity, setDoorEntity] = useState("");

  const apply = (res: Awaited<ReturnType<typeof loadPrintOverview>>) => {
    if (res.success) {
      setOverview(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  };
  const load = async () => apply(await loadPrintOverview(conferenceId));

  // Jobs move while you watch (a sticker leaving the station), so the list
  // refreshes while the tab is open.
  useEffect(() => {
    let live = true;
    const tick = () =>
      void loadPrintOverview(conferenceId).then((res) => {
        if (!live) return;
        if (res.success) {
          setOverview(res.data);
          setError(null);
        } else {
          setError(res.error);
        }
      });
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [conferenceId]);

  const base = `/admin/conference/${conferenceId}`;
  const sheet = (path: string) => `${base}${path}${path.includes("?") ? "&" : "?"}embed=1`;

  if (!overview) {
    return (
      <p className={`text-sm ${error ? "text-red-700" : "text-gray-500"}`}>{error ?? "Loading what there is to print…"}</p>
    );
  }

  const pkg = overview.latestPackage;
  const blocked = overview.blockingCount > 0;
  const packageState = blocked
    ? `${overview.blockingCount} problem${overview.blockingCount === 1 ? "" : "s"} stop it: ${overview.blocking[0]}`
    : pkg
      ? `Last made ${whenMountain(pkg.createdAt)}, template v${pkg.templateVersion ?? "?"}, ${
          pkg.includeBlanks ? "with blanks" : "named only"
        }. ${overview.named} named now.`
      : `Not made yet. ${overview.named} named badge${overview.named === 1 ? "" : "s"} to print.`;

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Badges</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Badge package"
            state={packageState}
            tone={blocked ? "blocked" : pkg ? "neutral" : "attention"}
            edit={{ href: `${base}/badges?mode=studio`, label: "Edit design" }}
            preview={{
              title: "Badge package",
              content: (
                <div className="space-y-4 text-sm text-gray-700">
                  <p>
                    {overview.template
                      ? `Template v${overview.template.version} (${overview.template.name}, ${overview.template.status}).`
                      : "No badge template yet: design one in Badge Ops."}{" "}
                    {overview.named} named badge{overview.named === 1 ? "" : "s"}, front and back, in the order set in
                    Badge Ops.
                  </p>
                  {overview.blocking.length > 0 ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="font-medium text-red-800">What stops it</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-800">
                        {overview.blocking.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                      {overview.blockingCount > overview.blocking.length ? (
                        <p className="mt-1 text-xs text-red-700">
                          …and {overview.blockingCount - overview.blocking.length} more. Fix them in Badge Ops.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {overview.textWarnings > 0 ? (
                    <p className="text-amber-800">
                      {overview.textWarnings} name{overview.textWarnings === 1 ? "" : "s"} may not fit the badge. Check
                      them in the studio before the final print.
                    </p>
                  ) : null}
                  {overview.unnamed > 0 ? (
                    <div>
                      <p className="font-medium text-gray-900">
                        {overview.unnamed} seat{overview.unnamed === 1 ? " has" : "s have"} nobody named
                      </p>
                      <p className="text-xs text-gray-500">
                        These companies still owe names. With blanks, each gets a card with the company printed and
                        the person left for the desk to fill in.
                      </p>
                      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                        {overview.unnamedByOrg.map((org) => (
                          <li key={org.name} className="flex items-baseline justify-between gap-3 text-xs">
                            <span className="truncate">{org.name}</span>
                            <span className="shrink-0 text-gray-500">{org.types}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {pkg?.artifactUrl ? (
                    <a
                      href={pkg.artifactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open the last package ↗
                    </a>
                  ) : null}
                </div>
              ),
            }}
            action={
              blocked || !overview.template
                ? null
                : {
                    label: pkg ? "Make it again" : "Make it",
                    consequence: `Builds the print file with template v${overview.template.version}: ${overview.named} named badge${
                      overview.named === 1 ? "" : "s"
                    }${includeBlanks && overview.unnamed > 0 ? ` and ${overview.unnamed} blank${overview.unnamed === 1 ? "" : "s"}` : ""}. Earlier packages stay in the list below.`,
                    onConfirm: async () => {
                      const res = await createPreprintedBadgeJob({
                        conferenceId,
                        templateVersion: overview.template!.version,
                        includeBlanks,
                      });
                      await load();
                      return res.success ? { success: true } : { success: false, error: res.error ?? "It could not be made." };
                    },
                  }
            }
            extra={
              overview.unnamed > 0 && !blocked ? (
                <label className="flex items-center gap-1.5 py-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={includeBlanks} onChange={(e) => setIncludeBlanks(e.target.checked)} />
                  With {overview.unnamed} blank{overview.unnamed === 1 ? "" : "s"}
                </label>
              ) : null
            }
          />
          <OperateRow
            title="Reprint one badge"
            state="Find the person, check their name, say which card is in hand. A sticker goes to the print station."
            extra={
              <button
                type="button"
                onClick={() => setReprintOpen(true)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Reprint…
              </button>
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Sheets</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Check-in cards"
            state="The cards on each booth table that confirm a meeting happened."
            preview={{ title: "Check-in cards", src: sheet("/check-in/cards"), printable: true }}
          />
          <OperateRow
            title="Attendee list"
            state="Everyone attending, in your name order."
            preview={{ title: "Attendee list", src: sheet("/check-in/door-list"), printable: true }}
          />
          {overview.doorEvents.length > 0 ? (
            <OperateRow
              title="Door list"
              state={doorEntity ? "Who has a ticket for this event, for the person at the door." : "Pick the event."}
              preview={
                doorEntity
                  ? {
                      title: "Door list",
                      src: sheet(`/check-in/door-list?entity=${doorEntity}`),
                      printable: true,
                    }
                  : null
              }
              extra={
                <select
                  value={doorEntity}
                  onChange={(e) => setDoorEntity(e.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  aria-label="Event"
                >
                  <option value="">Event…</option>
                  {overview.doorEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} · {formatCalendarDate(event.date)}
                    </option>
                  ))}
                </select>
              }
            />
          ) : null}
          <OperateRow
            title="Individual schedules"
            state="One page per person: their meetings, rooms and times."
            edit={{ href: `${base}/schedule`, label: "Meetings" }}
            preview={{ title: "Individual schedules", src: sheet("/check-in/schedules?view=people"), printable: true }}
          />
          <OperateRow
            title="Suite door sheets"
            state="For each suite door: who meets there, and when."
            preview={{ title: "Suite door sheets", src: sheet("/check-in/schedules?view=suites"), printable: true }}
          />
          <OperateRow
            title="Map"
            state="The floor plan on one page."
            edit={{ href: `${base}/floor-plan`, label: "Floor plan" }}
            preview={{ title: "Map", src: sheet("/directory?sheet=map"), printable: true }}
          />
          <OperateRow
            title="Directory"
            state="The printed directory, as the book is set."
            edit={{ href: `${base}/directory` }}
            preview={{ title: "Directory", src: sheet("/directory"), printable: true }}
          />
          <OperateRow
            title="Bursary meeting proof"
            state="Each bursary institution's meetings, and which the check-in cards confirmed."
            preview={{ title: "Bursary meeting proof", src: sheet("/bursary-proof"), printable: true }}
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Print queue</h3>
          <a href={`${base}/check-in/print-station`} className="text-xs font-medium text-gray-600 hover:text-gray-900">
            {station.stations === 0
              ? "Set up a print station ▸"
              : `${station.online ? "Station online" : "Station offline"}${station.queued ? ` · ${station.queued} waiting` : ""} ▸`}
          </a>
        </div>
        {overview.jobs.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">Nothing printed yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {overview.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {job.pipeline === "preprinted"
                      ? `Badge package v${job.templateVersion ?? "?"}, ${job.includeBlanks ? "with blanks" : "named only"}`
                      : `Reprint: ${job.personName ?? "—"}`}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {whenMountain(job.createdAt)} · {JOB_STATUS_WORDS[job.status] ?? job.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {job.artifactUrl ? (
                    <a
                      href={job.artifactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open ↗
                    </a>
                  ) : null}
                  {job.pipeline === "preprinted" && job.status === "pdf_generated" ? (
                    <ConfirmAction
                      label="Delivered"
                      consequence="Records that the printer has delivered this package."
                      size="sm"
                      onConfirm={async () => {
                        const res = await advanceBadgePrintJob({ jobId: job.id, nextStatus: "delivered" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                  {job.status === "sent_to_printer" ? (
                    <ConfirmAction
                      label="Cancel"
                      consequence="Takes it off the print station's queue. It will not print."
                      size="sm"
                      tone="danger"
                      onConfirm={async () => {
                        const res = await advanceBadgePrintJob({ jobId: job.id, nextStatus: "canceled" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                  {job.status !== "rendering" ? (
                    <ConfirmAction
                      label="Delete"
                      consequence="Removes this job and its history for good."
                      size="sm"
                      tone="danger"
                      onConfirm={async () => {
                        const res = await deleteBadgePrintJob({ conferenceId, jobId: job.id, reason: "Deleted in the War Room" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reprintOpen ? (
        <ReprintModal
          conferenceId={conferenceId}
          people={people}
          person={null}
          onClose={() => {
            setReprintOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Reprint one badge from the War Room: the desk's reprint, without the camera
 * (Stephen, 2026-10-23). What will print, correctable in place (updateField, as
 * at the desk); which card is in hand (cardChoices, the desk's choices); then
 * the one print engine.
 */
function ReprintModal({
  conferenceId,
  people,
  person,
  onClose,
}: {
  conferenceId: string;
  people: ConferencePerson[];
  /** Who, when the caller already knows; otherwise the modal asks. */
  person: { id: string; name: string | null } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string | null } | null>(person);
  const [draft, setDraft] = useState<{ preview: ReprintPreview; first: string; last: string; title: string } | null>(null);
  const [stock, setStock] = useState<BadgeStock>("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; artifactUrl: string | null } | null>(null);

  // The callers mount this only while it is open (keyed by person), so state
  // starts fresh for each reprint.
  const loadFor = useCallback(
    (personId: string) =>
      loadReprintPreview({ conferenceId, personId, includeCards: true }).then((res) => {
        if (!res.success) {
          setLoadError(res.error);
          return;
        }
        setDraft({ preview: res.data, first: res.data.firstName, last: res.data.lastName, title: res.data.roleTitle });
        setStock(res.data.suggestedStock ?? "none");
      }),
    [conferenceId]
  );
  useEffect(() => {
    if (person) void loadFor(person.id);
  }, [person, loadFor]);

  const choose = (next: { id: string; name: string | null }) => {
    setChosen(next);
    void loadFor(next.id);
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => `${p.display_name ?? ""} ${p.contact_email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [people, query]);

  const close = onClose;

  const changes = draft
    ? (
        [
          ["first_name", draft.first.trim(), draft.preview.firstName],
          ["last_name", draft.last.trim(), draft.preview.lastName],
          ["role_title", draft.title.trim(), draft.preview.roleTitle],
        ] as const
      ).filter(([, next, before]) => next !== before.trim())
    : [];
  const choices = cardChoices(draft?.preview.cards ?? null);
  const stockLabel = choices.find(([value]) => value === stock)?.[1] ?? "No card";
  const field = "w-full rounded bg-transparent px-1 text-center text-black focus:bg-amber-50 focus:outline-none";

  return (
    <Modal
      open
      onClose={close}
      title={chosen ? `Reprint: ${chosen.name ?? "badge"}` : "Reprint one badge"}
      footer={
        draft && !done ? (
          <ConfirmAction
            label="Print badge"
            consequence={[
              changes.length > 0 ? "Saves the corrected name to their record." : null,
              stock === "none"
                ? "Makes the full colour badge as a file for a colour printer: the label printer can't print it."
                : `Prints a sticker for the ${stockLabel.toLowerCase()} at the print station.`,
            ]
              .filter(Boolean)
              .join(" ")}
            onConfirm={async () => {
              for (const [column, next] of changes) {
                const saved = await updateField({
                  table: "contacts",
                  column,
                  entityId: draft.preview.contactId!,
                  newValue: next || null,
                });
                if (!saved.success) return { success: false, error: saved.error ?? "The name could not be saved." };
              }
              const res = await printBadge({
                conferenceId,
                personId: chosen!.id,
                // As at the desk: an edit IS the reason; otherwise it is not asked.
                reason: changes.length > 0 ? "name_change" : "ops_override",
                note: changes.length > 0 ? null : "Reprint from the War Room",
                stockInHand: stock,
              });
              if (!res.success) return res;
              const printed = res.data;
              setDone({
                text: !printed.labelPrintable
                  ? "The full colour badge is ready to print."
                  : printed.queueError
                    ? `Planned, but the print station refused it: ${printed.queueError}`
                    : printed.stationOnline
                      ? "Sent to the print station."
                      : "Sent, but the print station is offline. Start CSC Print Station on the laptop by the printer.",
                artifactUrl: printed.artifactUrl,
              });
              return { success: true };
            }}
          />
        ) : undefined
      }
    >
      <div className="space-y-4 p-5 text-sm">
        {!chosen ? (
          <div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
            <ul className="mt-2 divide-y divide-gray-100">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose({ id: p.id, name: p.display_name })}
                    className="w-full px-1 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{p.display_name ?? "Unnamed"}</span>
                    {p.contact_email ? <span className="ml-2 text-xs text-gray-500">{p.contact_email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : loadError ? (
          <p className="text-red-700">{loadError}</p>
        ) : !draft ? (
          <p className="text-gray-500">Loading their badge…</p>
        ) : done ? (
          <div className="space-y-2">
            <p className="font-medium text-gray-900">{done.text}</p>
            {done.artifactUrl ? (
              <a
                href={done.artifactUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open the badge ↗
              </a>
            ) : null}
          </div>
        ) : (
          <>
            {/* What prints, as it prints. Click a line to correct it. */}
            <div className="mx-auto max-w-xs rounded-lg border border-gray-300 bg-white p-4 text-center shadow-sm">
              {(["first", "last", "title"] as const).map((key) => (
                <input
                  key={key}
                  aria-label={key === "first" ? "First name" : key === "last" ? "Last name" : "Title"}
                  value={draft[key]}
                  disabled={!draft.preview.contactId}
                  placeholder={key === "title" ? "No title" : undefined}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={`${field} ${key === "first" ? "text-2xl font-bold uppercase" : key === "last" ? "text-lg" : "text-sm"}`}
                />
              ))}
              {draft.preview.organizationName ? (
                <p className="mt-1 text-sm font-semibold">{draft.preview.organizationName}</p>
              ) : null}
            </div>
            <p className="text-center text-xs text-gray-500">
              {draft.preview.contactId
                ? "Click a line to correct it. A correction saves to their record."
                : "This badge has no contact record to correct."}
            </p>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Which card is in hand?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {choices.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStock(value)}
                    aria-pressed={stock === value}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      stock === value ? "border-accent bg-red-50 text-accent" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {stock === "none" ? (
                <p className="mt-1 text-xs text-amber-800">No card: the label printer can&apos;t print a full badge.</p>
              ) : null}
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
