import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDoorRoster } from "@/lib/conference/attendance";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Door list | Check-in" };

/**
 * The printed backup list for one event's door (toolkit → Print list).
 *
 * Everyone whose access reaches the event, with a box to tick. Printed straight
 * from the browser, like the directory. ⛔ Required by the 2026-09-08 decisions:
 * the phone is never the only way in.
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
  if (!event) return <main className="p-6 text-sm text-gray-700">Pick an event on the desk first.</main>;

  const roster = await loadDoorRoster(db, id, event.id as string);
  const printedAt = new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" });

  return (
    <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-gray-900">
      {/* The site header and footer sit outside <main>: keep them off the paper
          (same rule as the benchmarking worksheet). */}
      <style>{`@media print { header, footer { display: none !important; } }`}</style>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{event.name as string}</h1>
          <p className="text-sm text-gray-600">
            {roster.length} people on the list · printed {printedAt}
          </p>
        </div>
        <span className="print:hidden"><PrintButton label="Print list" /></span>
      </div>
      <p className="mb-4 text-sm text-gray-600 print:hidden">
        Tick people off as they come in. Anyone already scanned at the door is marked. Not on the
        list? Let them in and note their name: the desk sells it to them afterwards.
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gray-900 text-left">
            <th className="w-10 py-2">In</th>
            <th className="py-2">Name</th>
            <th className="py-2">Organization</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((row) => (
            <tr key={row.personId} className="border-b border-gray-300">
              <td className="py-2">
                <span className="inline-flex h-5 w-5 items-center justify-center border border-gray-900 text-xs">
                  {row.inAlready ? "✓" : ""}
                </span>
              </td>
              <td className="py-2">{row.name}</td>
              <td className="py-2">{row.organizationName}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-8 border-t-2 border-gray-900 pt-2 text-sm font-semibold">Not on the list (names):</div>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="h-8 border-b border-gray-300" />
      ))}
    </main>
  );
}
