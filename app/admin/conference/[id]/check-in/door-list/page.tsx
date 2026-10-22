import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDoorRoster } from "@/lib/conference/attendance";
import { readPreferences } from "@/lib/profile/preferences";
import { parsePrintSort, PRINT_SORT_PREFERENCE_KEY } from "@/lib/conference/badges/arrangement";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Name list | Check-in" };

const SORT_WORDS = {
  person_first_name: "by first name",
  person_last_name: "by last name",
  organization_name: "by organization",
} as const;

/**
 * A printed list of names. Two lists, one page:
 *
 *   ?entity=<event>  the door's backup list (toolkit → Print list): everyone
 *                    whose access reaches the event, with a box to tick.
 *   no entity        the attendee list (War Room): everyone registered.
 *
 * Printed straight from the browser, like the directory. ⛔ Required by the
 * 2026-09-08 decisions: the phone is never the only way in.
 *
 * In the VIEWER's own name order, set once in the War Room. The print button
 * never asks: the moment you need paper is not the moment to choose a sort.
 */
export default async function DoorListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entity?: string }>;
}) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;

  const { entity } = await searchParams;
  const db = createAdminClient();
  const { data: event } = entity
    ? await db
        .from("conference_entities")
        .select("id, name, kind")
        .eq("id", entity)
        .eq("conference_id", id)
        .eq("kind", "event")
        .maybeSingle()
    : { data: null };
  if (entity && !event) return <main className="p-6 text-sm text-gray-700">That event isn&apos;t on this conference.</main>;

  const sort = parsePrintSort((await readPreferences(auth.ctx.userId))[PRINT_SORT_PREFERENCE_KEY]);
  const roster = await loadDoorRoster(db, id, (event?.id as string | undefined) ?? null, sort);
  const printedAt = new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" });
  const isDoor = Boolean(event);

  return (
    <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-gray-900">
      {/* The site header and footer sit outside <main>: keep them off the paper
          (same rule as the benchmarking worksheet). */}
      <style>{`@media print { header, footer { display: none !important; } }`}</style>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{isDoor ? (event?.name as string) : "Attendee list"}</h1>
          <p className="text-sm text-gray-600">
            {roster.length} people {isDoor ? "on the list" : "registered"}, {SORT_WORDS[sort]} · printed {printedAt}
          </p>
        </div>
        <span className="print:hidden"><PrintButton label="Print list" /></span>
      </div>
      {isDoor ? (
        <p className="mb-4 text-sm text-gray-600 print:hidden">
          Tick people off as they come in. Anyone already scanned at the door is marked. Not on the
          list? Let them in and note their name: the desk sells it to them afterwards.
        </p>
      ) : null}
      <p className="mb-4 text-xs text-gray-500 print:hidden">
        Sorted {SORT_WORDS[sort]}: your own choice, set in the War Room under What&apos;s next.
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gray-900 text-left">
            {isDoor ? <th className="w-10 py-2">In</th> : null}
            <th className="py-2">Name</th>
            <th className="py-2">Organization</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((row) => (
            <tr key={row.personId} className="border-b border-gray-300">
              {isDoor ? (
                <td className="py-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center border border-gray-900 text-xs">
                    {row.inAlready ? "✓" : ""}
                  </span>
                </td>
              ) : null}
              <td className="py-2">{row.name}</td>
              <td className="py-2">{row.organizationName}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isDoor ? (
        <>
          <div className="mt-8 border-t-2 border-gray-900 pt-2 text-sm font-semibold">Not on the list (names):</div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="h-8 border-b border-gray-300" />
          ))}
        </>
      ) : null}
    </main>
  );
}
