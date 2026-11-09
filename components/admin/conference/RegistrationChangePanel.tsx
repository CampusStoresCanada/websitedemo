"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRegistration, type RegistrationChangeRow } from "@/lib/actions/conference-registration-change";
import { formatCents } from "@/lib/utils";

/**
 * Staff: change somebody's registration to another at the price they paid,
 * such as a day pass bought for the wrong day. Search by school or person,
 * pick what it becomes, confirm. The person stays on the ticket; what the new
 * registration includes (receptions, offsites) comes with it.
 */
export default function RegistrationChangePanel({
  conferenceId,
  rows,
}: {
  conferenceId: string;
  rows: RegistrationChangeRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return rows
      .filter((r) => `${r.organizationName} ${r.holderName ?? ""}`.toLowerCase().includes(q))
      .slice(0, 25);
  }, [rows, query]);

  const change = (row: RegistrationChangeRow) => {
    const toId = choice[row.seatId] ?? row.targets[0]?.id;
    const target = row.targets.find((t) => t.id === toId);
    if (!target) return;
    const who = row.holderName ?? "this unassigned ticket";
    if (
      !window.confirm(
        `Change ${who} at ${row.organizationName} from ${row.currentName} to ${target.name}? ` +
          `Both are ${formatCents(row.paidUnitCents)}, so no money moves. What ${row.currentName} included ` +
          `goes, and what ${target.name} includes is added. ${row.holderName ?? "The ticket holder"} is emailed ` +
          `their updated registration, and the buyer an updated receipt.`
      )
    )
      return;
    startTransition(async () => {
      const result = await changeRegistration({ conferenceId, seatId: row.seatId, toEntityId: target.id });
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: `${result.data.holderName ?? "The ticket"} at ${row.organizationName} now holds ${result.data.toName}.`,
      });
      router.refresh();
    });
  };

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Change a registration</h2>
      <p className="mt-1 text-sm text-gray-600">
        For a ticket bought for the wrong day or type. Only registrations the school could buy, at the price it
        paid, are offered. The person stays on the ticket. Someone already on the meeting schedule can&apos;t be
        changed.
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a school or person"
        aria-label="Search a school or person"
        className="mt-3 w-full max-w-md rounded-md border border-gray-300 px-3 py-1.5 text-sm"
      />

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>
      )}

      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">No ticket matching that can be changed.</p>
      )}

      {matches.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {matches.map((row) => (
            <li key={row.seatId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-gray-700">
                <span className="font-medium text-gray-900">{row.holderName ?? "Unassigned ticket"}</span>
                <span className="ml-2 text-gray-500">
                  {row.organizationName}, {row.currentName} ({formatCents(row.paidUnitCents)})
                </span>
              </span>
              <span className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`change-${row.seatId}`}>
                  Change to
                </label>
                <select
                  id={`change-${row.seatId}`}
                  value={choice[row.seatId] ?? row.targets[0]?.id}
                  onChange={(e) => setChoice((c) => ({ ...c, [row.seatId]: e.target.value }))}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {row.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => change(row)}
                  disabled={isPending}
                  className="rounded-md border border-[#163D6D] px-3 py-1 text-xs font-semibold text-[#163D6D] hover:bg-[#163D6D] hover:text-white disabled:opacity-40"
                >
                  Change
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
