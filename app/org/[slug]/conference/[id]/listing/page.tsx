import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { answerOrgTask } from "@/lib/actions/conference-tasks";
import { loadOrgTasks } from "@/lib/conference/checklist-tasks";
import TaskChecklist from "@/components/conference/TaskChecklist";
import PublicationView from "@/components/publication/PublicationView";
import { composePublication, orgListingProof } from "@/lib/publication/composition";
import { loadDirectoryEntries } from "@/lib/publication/composition-loader";
import { PUBLICATION_FIELD_BY_KEY } from "@/lib/publication/completeness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your printed listing" };

/**
 * An exhibitor's own entry, rendered by the code that prints the directory.
 *
 * This exists because content complete is not content correct. Every automated
 * check can pass on a listing that is wrong — CSC populated many categories by
 * guessing, and a machine cannot tell a plausible guess from an accurate one.
 * Only somebody who knows the company can, and once it is at press that is
 * permanent.
 *
 * So the approval sits directly under the thing being approved, and the thing
 * being approved is the real render — not a mock-up of it.
 */
export default async function OrgListingProofPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id: conferenceId } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();
  const orgId = org.id;

  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) notFound();

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name")
    .eq("id", conferenceId)
    .maybeSingle();
  if (!conference) notFound();

  const publication = orgListingProof(conferenceId, orgId, `${org.name} — ${conference.name}`);
  const entries = await loadDirectoryEntries(publication.source);
  const doc = composePublication(publication, entries);
  const entry = doc.entries[0] ?? null;

  // The approval task lives on the Directory Listing checklist; show only that
  // one here rather than the org's whole to-do list, which lives a page up.
  const { data: checklist } = await db
    .from("conference_checklists")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("name", "Directory Listing")
    .maybeSingle();
  const tasks = checklist
    ? (await loadOrgTasks(db, conferenceId, orgId, checklist.id)).filter((t) => t.source === "self_reported")
    : [];

  async function handleAnswer(taskId: string, state: "done" | "not_applicable", evidence?: string) {
    "use server";
    return answerOrgTask({
      organizationId: orgId, conferenceId, taskId, state, evidence,
      revalidate: `/org/${slug}/conference/${conferenceId}/listing`,
    });
  }

  const missingRequired = entry
    ? entry.completeness.missing.filter((k) => PUBLICATION_FIELD_BY_KEY[k]?.tier === "required")
    : [];
  const missingEnhanced = entry
    ? entry.completeness.missing.filter((k) => PUBLICATION_FIELD_BY_KEY[k]?.tier === "enhanced")
    : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Your printed listing</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Exactly how {org.name} will appear in the printed directory.
          </p>
        </div>
        <Link href={`/org/${slug}/conference/${conferenceId}`}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Back to conference
        </Link>
      </div>

      {!entry ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            {org.name} doesn&rsquo;t hold a booth at this conference yet, so there&rsquo;s no
            directory listing to show.
          </p>
        </section>
      ) : (
        <>
          {missingRequired.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-semibold">This won&rsquo;t print as it stands</p>
              <p className="mt-0.5">
                Missing {missingRequired.map((k) => PUBLICATION_FIELD_BY_KEY[k].label.toLowerCase()).join(", ")}.
                {" "}<Link href={`/org/${slug}`} className="font-semibold underline">Add it on your profile</Link>.
              </p>
            </div>
          ) : null}

          {missingEnhanced.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">It will print, but it&rsquo;s thin</p>
              <p className="mt-0.5">
                No {missingEnhanced.map((k) => PUBLICATION_FIELD_BY_KEY[k].label.toLowerCase()).join(", ")}.
                These are what members read after your name.
                {" "}<Link href={`/org/${slug}`} className="font-semibold underline">Fill them in</Link>.
              </p>
            </div>
          ) : null}

          {entry.unrecognizedCategories.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Some categories aren&rsquo;t recognised</p>
              <p className="mt-0.5">
                {entry.unrecognizedCategories.join(", ")} — these won&rsquo;t place you anywhere in
                the category index. Pick from the standard list on your profile.
              </p>
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 bg-white p-2">
            <PublicationView doc={doc} />
          </section>

          {tasks.length > 0 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-base font-semibold text-gray-900">Sign off</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Once we go to press this is permanent. Check the categories especially — we filled
                in what we could guess, and a guess can look perfectly reasonable and still be wrong.
              </p>
              <div className="mt-2">
                <TaskChecklist tasks={tasks} onAnswer={handleAnswer} />
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
