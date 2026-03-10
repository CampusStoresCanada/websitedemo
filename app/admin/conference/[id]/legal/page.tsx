import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import LegalManager from "@/components/admin/conference/LegalManager";

export const metadata = { title: "Conference Legal | Admin" };

export default async function ConferenceLegalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conferenceResult = await getConference(id);

  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="space-y-4">
        <div className="text-sm text-gray-500">
          <Link href="/admin">Admin</Link> /{" "}
          <Link href="/admin/conference">Conference</Link> / Legal
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Conference not found. {conferenceResult.error ?? ""}
        </div>
      </main>
    );
  }

  const conference = conferenceResult.data;
  return (
    <main className="space-y-4">
      <div className="text-sm text-gray-500">
        <Link href="/admin">Admin</Link> /{" "}
        <Link href="/admin/conference">Conference</Link> /{" "}
        <Link href={`/admin/conference/${conference.id}`}>{conference.name}</Link> / Legal
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Legal & Compliance</h1>
          <p className="mt-1 text-sm text-gray-600">
            Versioned legal documents and acceptance coverage for {conference.name}.
          </p>
        </div>
        <Link
          href={`/admin/conference/${conference.id}`}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Back to Conference Dashboard
        </Link>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <LegalManager conferenceId={conference.id} />
      </section>
    </main>
  );
}
