"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRegistration, type RegistrationChangeRow } from "@/lib/actions/conference-registration-change";
import type { RegistrationListSeat, RegistrationSideSummary } from "@/lib/conference/registration-list";
import { formatCents, parseUTC } from "@/lib/utils";

type View = "delegates" | "delegateOrgs" | "exhibitors" | "exhibitorOrgs";

/**
 * Who is registered: delegates, the organizations they come from, exhibitors,
 * and the exhibiting organizations. One list, four ways to read it.
 *
 * Changing a registration (a ticket bought for the wrong day or type) is done
 * on the person's own row: a row offers it only when there is something that
 * registration could become at the price paid.
 */
export default function RegistrationsList({
  conferenceId,
  delegates,
  exhibitors,
  changeRows,
}: {
  conferenceId: string;
  delegates: RegistrationSideSummary;
  exhibitors: RegistrationSideSummary;
  changeRows: RegistrationChangeRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<View>("delegates");
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const changeBySeat = useMemo(() => new Map(changeRows.map((r) => [r.seatId, r])), [changeRows]);
  const side = view === "delegates" || view === "delegateOrgs" ? delegates : exhibitors;
  const showingOrgs = view === "delegateOrgs" || view === "exhibitorOrgs";
  const q = query.trim().toLowerCase();
  const has = (...parts: Array<string | null>) => !q || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  const people = side.people.filter((s) => has(s.holderName, s.organizationName, s.registrationName));
  const unnamed = side.unnamed.filter((s) => has(s.organizationName, s.registrationName));
  const organizations = side.organizations.filter((o) => has(o.organizationName, ...o.people));

  // Unnamed seats read as one line per organization and registration.
  const groups = new Map<string, RegistrationListSeat[]>();
  for (const seat of unnamed) {
    const key = `${seat.organizationId}|${seat.registrationName}`;
    groups.set(key, [...(groups.get(key) ?? []), seat]);
  }
  const unnamedGroups = [...groups.values()];

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

  const changeControl = (seatId: string | undefined) => {
    const row = seatId ? changeBySeat.get(seatId) : undefined;
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
          className="max-w-[14rem] rounded-md border border-gray-300 px-2 py-1 text-xs"
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
    );
  };

  const tabs: Array<{ id: View; label: string; count: number }> = [
    { id: "delegates", label: "Delegates", count: delegates.counts.people },
    { id: "delegateOrgs", label: "Delegate organizations", count: delegates.counts.organizations },
    { id: "exhibitors", label: "Exhibitors", count: exhibitors.counts.people },
    { id: "exhibitorOrgs", label: "Exhibitor organizations", count: exhibitors.counts.organizations },
  ];
  const testTag = <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Test</span>;
  const th = "px-4 py-2 text-left text-xs font-medium uppercase text-gray-500";

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Who is registered</h2>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Registrations">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => setView(tab.id)}
            className={`rounded-lg border px-3 py-2 text-left ${
              view === tab.id ? "border-[#163D6D] bg-[#163D6D] text-white" : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50"
            }`}
          >
            <span className="block text-2xl font-semibold tabular-nums">{tab.count}</span>
            <span className={`block text-xs ${view === tab.id ? "text-white/80" : "text-gray-500"}`}>{tab.label}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-gray-600">
        {side.counts.unnamed > 0
          ? `${side.counts.unnamed} more ${side.counts.unnamed === 1 ? "registration is" : "registrations are"} bought with nobody named yet.`
          : "Every registration bought has somebody named to it."}
        {side.counts.testSeats > 0 && ` Test organizations are listed and marked, and are not counted.`}
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a person, organization or registration"
        aria-label="Search a person, organization or registration"
        className="mt-3 w-full max-w-md rounded-md border border-gray-300 px-3 py-1.5 text-sm"
      />

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>
      )}

      {showingOrgs ? (
        organizations.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No organization matches.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={th}>Organization</th>
                  <th className={th}>Registrations</th>
                  <th className={th}>Named</th>
                  <th className={th}>People</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {organizations.map((org) => (
                  <tr key={org.organizationId} className="align-top">
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">
                      {org.organizationName}
                      {org.isTestOrg && testTag}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {org.registrations.map((r) => (
                        <span key={r.name} className="block">
                          {r.name}
                          {r.seats > 1 ? ` ×${r.seats}` : ""}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-2 text-sm tabular-nums text-gray-700">
                      {org.named} of {org.seats}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {org.people.length > 0 ? org.people.join(", ") : <span className="text-gray-400">Nobody named yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {people.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">{q ? "Nobody matches." : "Nobody is named to a registration yet."}</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Organization</th>
                    <th className={th}>Registration</th>
                    <th className={th}>Since</th>
                    <th className={`${th} text-right`}>Change to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {people.map((seat) => (
                    <tr key={seat.seatId}>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">{seat.holderName ?? "Unnamed person"}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">
                        {seat.organizationName}
                        {seat.isTestOrg && testTag}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{seat.registrationName}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {seat.seatedAt ? parseUTC(seat.seatedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : ""}
                      </td>
                      <td className="px-4 py-2 text-right">{changeControl(seat.seatId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {unnamedGroups.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-gray-900">Bought, nobody named yet</h3>
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {unnamedGroups.map((group) => {
                  const first = group[0];
                  return (
                    <li key={`${first.organizationId}|${first.registrationName}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                      <span className="text-gray-700">
                        <span className="font-medium text-gray-900">{first.organizationName}</span>
                        {first.isTestOrg && testTag}
                        <span className="ml-2 text-gray-500">
                          {first.registrationName}
                          {group.length > 1 ? ` ×${group.length}` : ""}
                        </span>
                      </span>
                      {changeControl(group.find((s) => changeBySeat.has(s.seatId))?.seatId)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
