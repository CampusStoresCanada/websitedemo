"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDeskStaff, type DeskStaffRow } from "@/lib/actions/conference-desk-staff";
import { endAppointment, searchPeopleForAppointment } from "@/lib/actions/capability-appointments";
import { clearDeskPin } from "@/lib/actions/desk-pin";
import ConfirmAction from "@/components/ui/ConfirmAction";

/**
 * Who can run this conference's check-in desk.
 *
 * ⛔ Assigned here, by conference — the Access page no longer offers it. Staff
 * operate the conference (check in, find, reprint, name walk-ups, sell) and
 * never design it. Removing someone ends their appointment today, the same
 * action the Access page uses; it is kept as history, never deleted.
 */
export default function DeskStaffPanel({
  conferenceId,
  rows,
}: {
  conferenceId: string;
  rows: DeskStaffRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [email, setEmail] = useState("");
  const [firstDay, setFirstDay] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const q = search.trim();
    if (picked || q.length < 2) return;
    const t = setTimeout(async () => setResults(await searchPeopleForAppointment(q)), 250);
    return () => clearTimeout(t);
  }, [search, picked]);
  // Nothing to show until there is something to search for.
  const shownResults = picked || search.trim().length < 2 ? [] : results;

  const reset = () => {
    setSearch("");
    setPicked(null);
    setEmail("");
    setFirstDay("");
    setLastDay("");
    setPermanent(false);
    setReason("");
  };

  const add = async () => {
    setBusy("add");
    setMessage(null);
    const result = await addDeskStaff({
      conferenceId,
      profileId: picked?.id,
      email: picked ? undefined : email,
      firstDay: permanent ? undefined : firstDay || undefined,
      lastDay: permanent ? undefined : lastDay || undefined,
      permanent,
      reason,
    });
    setBusy(null);
    if (!result.success) {
      setMessage({ text: result.error, ok: false });
      return;
    }
    setMessage({
      text: result.data.invited
        ? "Added. They have been emailed an invitation to set their password."
        : "Added.",
      ok: true,
    });
    reset();
    setOpen(false);
    router.refresh();
  };

  const remove = async (assignmentId: string) => {
    setBusy(assignmentId);
    setMessage(null);
    const result = await endAppointment(assignmentId);
    setBusy(null);
    if (!result.success) return { success: false, error: result.error ?? "Could not remove them." };
    router.refresh();
    return { success: true };
  };

  // Forgotten PIN, or someone else learned it: clear it, and they choose a new
  // one (after a password sign-in) the next time they open the desk.
  const resetPin = async (r: DeskStaffRow) => {
    if (!r.profileId) return { success: false, error: "They have no account to clear a PIN on." };
    setBusy(`pin:${r.assignmentId}`);
    setMessage(null);
    const result = await clearDeskPin({ conferenceId, profileId: r.profileId });
    setBusy(null);
    if (!result.success) return { success: false, error: result.error };
    setMessage({ text: `${r.name}'s PIN is cleared. They choose a new one next time they open the desk.`, ok: true });
    router.refresh();
    return { success: true };
  };

  const when = (r: DeskStaffRow) =>
    r.permanent
      ? "Permanent, every conference"
      : r.firstDay && r.lastDay
        ? r.firstDay === r.lastDay
          ? r.firstDay
          : `${r.firstDay} to ${r.lastDay}`
        : "Registration open to the last day";

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Desk staff</h2>
          <p className="mt-1 text-sm text-gray-600">
            Volunteers and temps who run the check-in desk. They can check people in, reprint
            badges, name walk-ups to a company&apos;s open seats and sell or invoice an existing
            company. They cannot change badges, the catalogue or prices.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add staff
          </button>
        ) : null}
      </div>

      {message ? (
        <p className={`mt-3 text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Person</label>
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded border border-gray-300 bg-white px-3 py-2">
                <span className="text-sm text-gray-900">{picked.name}</span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people who already have a login…"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                {shownResults.length > 0 ? (
                  <ul className="mt-1 max-h-40 divide-y divide-gray-100 overflow-y-auto rounded border border-gray-200 bg-white">
                    {shownResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked(p);
                            setResults([]);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="…or a new person's email (they will be invited)"
                  className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Allow permanent access
              <span className="block text-xs text-gray-500">
                For permanent staff: the desk at every conference, with no end date, and they stay
                on staff. Leave unticked for volunteers and temps.
              </span>
            </span>
          </label>

          {!permanent ? (
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">First day (optional)</label>
                  <input
                    type="date"
                    value={firstDay}
                    onChange={(e) => setFirstDay(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Last day (optional)</label>
                  <input
                    type="date"
                    value={lastDay}
                    onChange={(e) => setLastDay(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Blank: from registration opening to the conference&apos;s last day, following the
                conference if its dates change. For two separate days, add them twice.
              </p>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">What they are doing</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Registration desk volunteer"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy === "add" || (!picked && !email.trim()) || !reason.trim()}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {busy === "add" ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        {rows.length === 0 ? (
          <p className="rounded-lg bg-gray-50 py-6 text-center text-sm text-gray-500">No desk staff yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {rows.map((r) => (
              <li key={r.assignmentId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    {when(r)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                {r.hasPin ? (
                  <ConfirmAction
                    label="Reset PIN"
                    consequence={`Clears ${r.name}'s PIN. They sign in with their password and choose a new one next time they open the desk.`}
                    disabled={busy !== null}
                    onConfirm={() => resetPin(r)}
                  />
                ) : (
                  <span className="text-xs text-gray-400">No PIN yet</span>
                )}
                <ConfirmAction
                  label="Remove"
                  tone="danger"
                  consequence={`Ends ${r.name}'s check-in desk access now. A desk they are signed in to stops working for them.`}
                  disabled={busy !== null}
                  onConfirm={() => remove(r.assignmentId)}
                />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
