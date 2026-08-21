import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import PublicationView from "@/components/publication/PublicationView";
import { composePublication, conferenceDirectory } from "@/lib/publication/composition";
import {
  loadDirectoryEntries,
  loadPlacementsForPublication,
  loadSurfacesForPublication,
} from "@/lib/publication/composition-loader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Directory | Conference Admin" };

/**
 * Renders the conference directory from the live composition.
 *
 * Admin-only for now: it's the first renderer over the publication model, and
 * the printed directory is not announced yet. Print it straight from the
 * browser — the `@media print` rules in PublicationView are the whole baseline
 * print pipeline.
 */
export default async function ConferenceDirectoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">Admins only.</main>;
  }

  const { id } = await params;
  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code")
    .eq("id", id)
    .maybeSingle();

  if (!conference) {
    return <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">Conference not found.</main>;
  }

  const publication = conferenceDirectory(conference.id, `${conference.name} — Directory`);
  const surfaces = await loadSurfacesForPublication(conference.id);
  const [entries, placements] = await Promise.all([
    loadDirectoryEntries(publication.source),
    loadPlacementsForPublication(conference.id, surfaces),
  ]);
  const doc = composePublication(publication, entries, surfaces, placements);

  const { notes } = doc;
  const hasWarnings =
    notes.uncategorized.length > 0 ||
    notes.unrecognizedCategories.length > 0 ||
    notes.excludedByDepartment > 0 ||
    notes.excludedAsNotPrintReady > 0;

  return (
    <main>
      {/* Screen-only chrome — the publication itself is what prints. */}
      <div className="print:hidden max-w-5xl mx-auto px-5 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Directory preview</h1>
            <p className="mt-1 text-sm text-gray-500">
              Composed live. Print or save as PDF straight from your browser.
            </p>
          </div>
          <Link
            href={`/admin/conference/${conference.id}/floor-plan`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Floor plan
          </Link>
        </div>

        {hasWarnings ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Before this goes to press</p>
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
              {notes.uncategorized.length > 0 ? (
                <li>
                  <strong>{notes.uncategorized.length}</strong> printing under
                  &ldquo;Uncategorized&rdquo; — {notes.uncategorized.join(", ")}
                </li>
              ) : null}
              {notes.unrecognizedCategories.length > 0 ? (
                <li>
                  Off-taxonomy category values needing a re-map:{" "}
                  {notes.unrecognizedCategories.join(", ")}
                </li>
              ) : null}
              {notes.excludedByDepartment > 0 ? (
                <li>{notes.excludedByDepartment} excluded by the department filter</li>
              ) : null}
              {notes.excludedAsNotPrintReady > 0 ? (
                <li>{notes.excludedAsNotPrintReady} excluded as not print-ready</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-gray-400">
          {notes.totalCandidates} candidate{notes.totalCandidates === 1 ? "" : "s"} ·{" "}
          {doc.entries.length} listed
        </p>
      </div>

      <PublicationView doc={doc} />
    </main>
  );
}
