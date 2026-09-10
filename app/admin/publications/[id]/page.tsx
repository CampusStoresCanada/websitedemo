import Link from "next/link";
import PublicationView from "@/components/publication/PublicationView";
import { requireAdmin } from "@/lib/auth/guards";
import { composeSavedPublication } from "@/lib/publication/render";
import { loadPrintUsage } from "@/lib/publication/scan-tracking";
import { loadPublication } from "@/lib/publication/store";
import { summarizeConsentAsk } from "@/lib/publication/consent-ask";
import ConsentAskPanel from "@/components/publication/ConsentAskPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publication | Admin" };

/**
 * Renders any saved publication, whatever it draws on.
 *
 * The conference directory page is the same thing scoped to one conference;
 * this one exists because the network directory has no single conference — it
 * spans members and partners too — and because a publication is a thing in its
 * own right, not a tab on a conference.
 */
export default async function PublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">Admins only.</main>;
  }

  const { id } = await params;
  const saved = await loadPublication(id);
  if (!saved) {
    return (
      <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">
        Publication not found, or its stored definition has no usable source.
      </main>
    );
  }

  const doc = await composeSavedPublication(saved.publication);
  const usage = await loadPrintUsage(doc.entries.length);
  const ask = await summarizeConsentAsk(saved.publication);
  const { notes } = doc;
  const { rejected } = saved;

  const hasWarnings =
    rejected.length > 0 ||
    notes.uncategorized.length > 0 ||
    notes.unrecognizedCategories.length > 0 ||
    notes.excludedByDepartment > 0 ||
    notes.excludedAsNotPrintReady > 0;

  // What each section actually pulled, so "Partners: 41" is visible before
  // anyone prints 41 pages of it.
  //
  // Distinct organisations, NOT the number of entries rendered: grouping by
  // category repeats a company under every department it serves, so a straight
  // sum reported 30 exhibitors as 33.
  const sectionCounts = doc.sections.flatMap((s) =>
    s.type === "listings"
      ? [{
          title: s.title,
          count: new Set(s.groups.flatMap((g) => g.entries.map((e) => e.orgId))).size,
          style: s.style,
        }]
      : s.type === "people"
        ? [{ title: s.title, count: s.people.length, style: "people" }]
        : []
  );

  return (
    <main>
      {/* Screen-only chrome — the publication itself is what prints. */}
      <div className="print:hidden max-w-5xl mx-auto px-5 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin/publications" className="text-xs text-gray-500 hover:underline">
              ← All publications
            </Link>
            <h1 className="mt-1 text-xl font-bold text-gray-900">{doc.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              Print or save as PDF straight from your browser, or package it for InDesign.
            </p>
          </div>
          <a
            href={`/admin/publications/${id}/export`}
            className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a]"
          >
            Export for InDesign
          </a>
        </div>

        {sectionCounts.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
            {sectionCounts.map((s) => (
              <div key={`${s.title}-${s.style}`}>
                <dt className="text-xs text-gray-500">{s.title}</dt>
                <dd className="text-lg font-bold tabular-nums text-[#163D6D]">{s.count}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {hasWarnings ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Before this goes to press</p>
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
              {rejected.map((r) => (
                <li key={r}>
                  <strong>Ignored part of the saved definition:</strong> {r}
                </li>
              ))}
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

        <ConsentAskPanel
          stats={{
            publicationId: id,
            listed: ask.listed,
            decided: ask.decided,
            undecided: ask.undecided,
            askable: ask.askable,
            noEmail: ask.noEmail,
            alreadyAsked: ask.alreadyAsked,
            suppressed: ask.suppressed,
            sample: ask.candidates.slice(0, 8).map((c) => ({
              name: c.name, orgName: c.orgName, email: c.email,
            })),
          }}
        />

        {usage.totalScans > 0 ? (
          <p className="mt-3 text-xs text-gray-500">
            {usage.printScans} scans off paper · {usage.listingsScanned} of {usage.listingsPrinted}{" "}
            listings reached
          </p>
        ) : null}

        <p className="mt-3 text-xs text-gray-400">
          {notes.totalCandidates} candidate{notes.totalCandidates === 1 ? "" : "s"} ·{" "}
          {doc.entries.length} distinct organisation{doc.entries.length === 1 ? "" : "s"} listed
        </p>
      </div>

      <PublicationView doc={doc} />
    </main>
  );
}
