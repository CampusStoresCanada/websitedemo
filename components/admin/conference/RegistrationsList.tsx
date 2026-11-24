"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRegistration, type RegistrationChangeRow } from "@/lib/actions/conference-registration-change";
import {
  BADGE_LABEL,
  DEFAULT_FILTERS,
  countRegistrations,
  registrationsCsv,
  viewRegistrations,
  type BadgeColour,
  type RegistrationFilters,
  type RegistrationListSeat,
  type SortKey,
} from "@/lib/conference/registration-list-view";
import { formatCents } from "@/lib/utils";

const PAGE = 25;

/** The badge overlay colours as a light wash across the whole row, with a full-colour edge: delegate red, exhibitor blue, staff white. */
const ROW: Record<BadgeColour, { row: string; muted: string; tile: string }> = {
  delegate: { row: "bg-[#e72a28]/10 text-gray-900 shadow-[inset_4px_0_0_#e72a28]", muted: "text-gray-500", tile: "border-[#e72a28] bg-[#e72a28] text-white" },
  exhibitor: { row: "bg-[#16345a]/10 text-gray-900 shadow-[inset_4px_0_0_#16345a]", muted: "text-gray-500", tile: "border-[#16345a] bg-[#16345a] text-white" },
  staff: { row: "bg-white text-gray-900 shadow-[inset_4px_0_0_#d1d5db]", muted: "text-gray-500", tile: "border-gray-400 bg-white text-gray-900" },
};

/** Hand a file to the browser to save. */
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
 * Who is registered: one list of every registration, coloured like the badge
 * the person wears, with filters, a search that looks through all of it, and
 * CSV files of the whole list or of what is on screen.
 *
 * Changing a registration (a ticket bought for the wrong day or type) is done
 * on the person's own row: a row offers it only when there is something that
 * registration could become at the price paid.
 */
export default function RegistrationsList({
  conferenceId,
  seats,
  changeRows,
}: {
  conferenceId: string;
  seats: RegistrationListSeat[];
  changeRows: RegistrationChangeRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<RegistrationFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "organization", descending: false });
  const [showAll, setShowAll] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const changeBySeat = useMemo(() => new Map(changeRows.map((r) => [r.seatId, r])), [changeRows]);
  const counts = useMemo(() => countRegistrations(seats), [seats]);
  const registrationNames = useMemo(
    () => [...new Set(seats.map((s) => s.registrationName))].sort((a, b) => a.localeCompare(b)),
    [seats]
  );
  const searching = query.trim().length > 0;
  const view = viewRegistrations(seats, { query, filters, sort });
  const shown = showAll ? view : view.slice(0, PAGE);
  const anyChange = shown.some((s) => changeBySeat.has(s.seatId));

  const setFilter = (patch: Partial<RegistrationFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShowAll(false);
  };
  const today = new Date().toISOString().slice(0, 10);

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

  const changeControl = (seatId: string) => {
    const row = changeBySeat.get(seatId);
    if (!row) return null;
    return (
      <span className="flex items-center justify-end gap-2">
        <label className="sr-only" htmlFor={`change-${row.seatId}`}>
          Change to
        </label>
        <select
          id={`change-${row.seatId}`}
          value={choice[row.seatId] ?? row.targets[0]?.id}
          onChange={(e) => setChoice((c) => ({ ...c, [row.seatId]: e.target.value }))}
          className="max-w-[14rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
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
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-40"
        >
          Change
        </button>
      </span>
    );
  };

  const th = "px-4 py-2 text-left text-xs font-medium uppercase text-gray-500";
  const sortHeader = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th className={th} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => setSort({ key, descending: active ? !sort.descending : false })}
          className="inline-flex items-center gap-1 uppercase hover:text-gray-900"
          title={`Sort by ${label.toLowerCase()}, ${active && !sort.descending ? "Z to A" : "A to Z"}`}
        >
          {label}
          <span aria-hidden className={active ? "text-gray-900" : "text-gray-300"}>
            {active && sort.descending ? "▼" : "▲"}
          </span>
        </button>
      </th>
    );
  };

  const tiles: Array<{ id: BadgeColour | "all"; label: string; className: string }> = [
    { id: "all", label: "Everyone", className: "border-gray-300 bg-gray-100 text-gray-900" },
    { id: "delegate", label: "Delegates", className: ROW.delegate.tile },
    { id: "exhibitor", label: "Exhibitors", className: ROW.exhibitor.tile },
    { id: "staff", label: "Staff", className: ROW.staff.tile },
  ];
  const selectClass = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  const exportButton =
    "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40";

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">Who is registered</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={exportButton}
            disabled={view.length === 0}
            title="A CSV of the rows below, every one of them, in this order"
            onClick={() => saveFile(`registrations-view-${today}.csv`, registrationsCsv(view))}
          >
            Export view ({view.length})
          </button>
          <button
            type="button"
            className={exportButton}
            title="A CSV of every registration, named or not"
            onClick={() =>
              saveFile(
                `registrations-all-${today}.csv`,
                registrationsCsv(
                  viewRegistrations(seats, { query: "", filters: { badge: "all", registration: "all", named: "all" }, sort })
                )
              )
            }
          >
            Export all ({seats.length})
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const on = !searching && filters.badge === tile.id;
          const c = counts[tile.id];
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter({ badge: tile.id })}
              className={`rounded-lg border px-3 py-2 text-left ${tile.className} ${
                on ? "ring-2 ring-gray-900 ring-offset-2" : "opacity-80 hover:opacity-100"
              }`}
            >
              <span className="block text-2xl font-semibold tabular-nums">{c.people}</span>
              <span className="block text-xs">
                {tile.label}, from {c.organizations} {c.organizations === 1 ? "organization" : "organizations"}
              </span>
              <span className="block text-xs opacity-80">{c.unnamed} not named yet</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowAll(false);
          }}
          placeholder="Search every registration"
          aria-label="Search every registration"
          className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Registration type"
          value={filters.registration}
          onChange={(e) => setFilter({ registration: e.target.value })}
          disabled={searching}
          className={selectClass}
        >
          <option value="all">All registration types</option>
          {registrationNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Named or not"
          value={filters.named}
          onChange={(e) => setFilter({ named: e.target.value as RegistrationFilters["named"] })}
          disabled={searching}
          className={selectClass}
        >
          <option value="named">Named people</option>
          <option value="unnamed">Not named yet</option>
          <option value="all">Named and not named</option>
        </select>
      </div>
      {searching && (
        <p className="mt-2 text-sm text-gray-600">Searching every registration. The filters are set aside while you search.</p>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>
      )}

      {view.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{searching ? "Nothing matches." : "No registration fits these filters."}</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {sortHeader("name", "Name")}
                  {sortHeader("organization", "Organization")}
                  {sortHeader("registration", "Registration type")}
                  <th className={th}>Email</th>
                  <th className={th}>Emergency contact</th>
                  {anyChange && <th className={`${th} text-right`}>Change to</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((seat) => {
                  const colour = ROW[seat.badge];
                  const none = <span className={colour.muted}>None given</span>;
                  return (
                    <tr key={seat.seatId} className={`border-t border-gray-200 ${colour.row}`} title={BADGE_LABEL[seat.badge]}>
                      <td className="px-4 py-2 text-sm font-semibold">
                        {seat.holderPersonId ? (
                          seat.holderName ?? "Unnamed person"
                        ) : (
                          <span className={`font-normal italic ${colour.muted}`}>Not named yet</span>
                        )}
                        <span className="sr-only">, {BADGE_LABEL[seat.badge]} badge</span>
                      </td>
                      <td className="px-4 py-2 text-sm">{seat.organizationName}</td>
                      <td className="px-4 py-2 text-sm">{seat.registrationName}</td>
                      <td className="px-4 py-2 text-sm">
                        {seat.email ? (
                          <a href={`mailto:${seat.email}`} className="underline decoration-current/40 hover:decoration-current">
                            {seat.email}
                          </a>
                        ) : seat.holderPersonId ? (
                          none
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {seat.emergencyContactName || seat.emergencyContactPhone ? (
                          <>
                            {seat.emergencyContactName}
                            {seat.emergencyContactName && seat.emergencyContactPhone ? ", " : ""}
                            {seat.emergencyContactPhone}
                          </>
                        ) : seat.holderPersonId ? (
                          none
                        ) : null}
                      </td>
                      {anyChange && <td className="px-4 py-2 text-right">{changeControl(seat.seatId)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span>
              Showing {shown.length} of {view.length}
            </span>
            {view.length > PAGE && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {showAll ? `Show the first ${PAGE}` : `Show all ${view.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
