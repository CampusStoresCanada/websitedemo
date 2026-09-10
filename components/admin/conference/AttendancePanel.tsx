import type { EntityAttendance } from "@/lib/conference/attendance";

/**
 * How many people each capped thing will admit.
 *
 * ⛔ Three counts, deliberately, because each is wrong on its own:
 *
 *   Sold on it — seats bought against this thing directly. The number that was
 *                already available, and the misleading one: a day pass includes
 *                the evening event on the eve of its day, so a capped $99
 *                reception admits people who never bought a seat on it. On the
 *                2027 catalogue that is 1 versus 14.
 *   Tickets    — every seat whose access closure reaches here, named or not.
 *                The catering number: an unnamed seat is sold and will be used.
 *   Named      — tickets in a person's hands. The door ceiling, because an
 *                unnamed seat has no person, so no badge, so nothing to present.
 *
 * Showing all three is the point: the gap between them is the information.
 */
export function AttendancePanel({ rows }: { rows: EntityAttendance[] }) {
  const capped = rows.filter((row) => row.capacity !== null);
  const uncapped = rows.filter((row) => row.capacity === null);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Expected attendance</h2>
      <p className="mt-1 text-sm text-gray-600">
        A seat is a ticket, and assigning it to a person is how the ticket gets given.
        <strong> Tickets</strong> counts everything that admits somebody here — including
        seats nobody has been named to yet, because those are sold and will be used.
        <strong> Named</strong> counts the tickets currently in someone&apos;s hands, which
        is the most anyone could scan at a door.
      </p>

      {capped.length > 0 ? (
        <Table rows={capped} caption="Capped — somebody owns these numbers" />
      ) : null}
      {uncapped.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-700">
            Uncapped ({uncapped.length}) — meals and days, for catering estimates
          </summary>
          <Table rows={uncapped} caption={null} />
        </details>
      ) : null}
    </section>
  );
}

function Table({ rows, caption }: { rows: EntityAttendance[]; caption: string | null }) {
  return (
    <div className="mt-3">
      {caption ? (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {caption}
        </p>
      ) : null}
      {/* Wide content scrolls inside its own container rather than the page. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-1 pr-3 font-medium">Thing</th>
              <th className="py-1 pr-3 text-right font-medium">Cap</th>
              <th className="py-1 pr-3 text-right font-medium">Sold on it</th>
              <th className="py-1 pr-3 text-right font-medium">Tickets</th>
              <th className="py-1 pr-3 text-right font-medium">Named</th>
              <th className="py-1 text-right font-medium">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entityId} className="border-b border-gray-100 last:border-0">
                <td className="py-1.5 pr-3 text-gray-900">
                  {row.name}
                  {row.over > 0 ? (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                      {row.over} over
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-600">
                  {row.capacity ?? "—"}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{row.directSeats}</td>
                <td className="py-1.5 pr-3 text-right font-medium text-gray-900">
                  {row.expected}
                </td>
                {/* ⚠️ The door number. An unnamed seat is a sold ticket nobody
                    holds — no person, so no badge, so nothing to present. */}
                <td className="py-1.5 pr-3 text-right text-gray-600">{row.expectedNamed}</td>
                <td className="py-1.5 text-right text-gray-500">
                  {/* Stays 0 until a door exists to scan at — see
                      planning/conference-check-in-model.md. */}
                  {row.scanned || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AttendancePanel;
