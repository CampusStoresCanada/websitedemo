import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPublications } from "@/lib/publication/store";
import { createNetworkDirectory } from "@/lib/actions/publications";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publications | Admin" };

/**
 * Every saved publication, regardless of what it draws on.
 *
 * Deliberately not under /admin/conference: a publication is not a conference
 * feature. The network directory spans members and partners who have nothing to
 * do with any particular show, and filing the tool under one conference is how
 * it would end up rebuilt from scratch next year.
 */
export default async function PublicationsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">Admins only.</main>;
  }

  const db = createAdminClient();
  const [publications, { data: conferences }] = await Promise.all([
    listPublications(),
    db.from("conference_instances").select("id, name, year").order("year", { ascending: false }).limit(5),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-5 py-8">
      <h1 className="text-xl font-bold text-gray-900">Publications</h1>
      <p className="mt-1 text-sm text-gray-500">
        Saved, re-runnable directory definitions. Run one to get the current book — on screen,
        printed from the browser, or packaged for InDesign.
      </p>

      {/* People go in this book, so consent is a precondition, not a polish
          item. Standing notice until opt-in is collected and enforced — a
          printed book cannot un-list someone afterwards. */}
      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Print consent has not been collected yet</p>
        <p className="mt-1">
          People are currently included unless they have been hidden — that is opt-out. Nothing
          here should go to press until the opt-in campaign has run and everyone listed has seen
          their own entry.
        </p>
      </div>

      <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {publications.length === 0 ? (
          <li className="px-4 py-6 text-sm text-gray-500">
            Nothing saved yet. Create one below.
          </li>
        ) : (
          publications.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <Link
                  href={`/admin/publications/${p.id}`}
                  className="text-sm font-semibold text-[#163D6D] hover:underline"
                >
                  {p.title}
                </Link>
                <p className="text-xs text-gray-500">{p.name}</p>
              </div>
              <a
                href={`/admin/publications/${p.id}/export`}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Export for InDesign
              </a>
            </li>
          ))
        )}
      </ul>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-900">New network directory</h2>
        <p className="mt-1 text-xs text-gray-500">
          Exhibitors, partners, member stores and everyone&rsquo;s people, cross-referenced. Pick
          the conference whose floor plan and exhibitor list it should carry.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(conferences ?? []).map((c) => (
            <form
              key={c.id}
              action={async () => {
                "use server";
                await createNetworkDirectory(c.id);
              }}
            >
              <button
                type="submit"
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a]"
              >
                {c.name} ({c.year})
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
