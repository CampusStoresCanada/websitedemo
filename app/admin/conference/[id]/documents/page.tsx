import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import { parseConferenceDocuments } from "@/lib/conference-documents";
import ConferenceDocumentsEditor from "@/components/admin/conference/ConferenceDocumentsEditor";

export const metadata = { title: "Conference Documents | Admin" };

export default async function ConferenceDocumentsPage({
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
          <Link href="/admin/conference">Conference</Link> / Documents
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Conference not found. {conferenceResult.error ?? ""}
        </div>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const documents = parseConferenceDocuments(conference.documents);

  return (
    <main className="space-y-4">
      <div className="text-sm text-gray-500">
        <Link href="/admin">Admin</Link> /{" "}
        <Link href="/admin/conference">Conference</Link> /{" "}
        <Link href={`/admin/conference/${conference.id}`}>{conference.name}</Link> / Documents
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="mt-1 text-sm text-gray-600">
          Contracts, planning docs, and reference links for this conference. Internal use only — not shown to registrants.
        </p>
      </div>

      <ConferenceDocumentsEditor conferenceId={conference.id} initialDocuments={documents} />
    </main>
  );
}
