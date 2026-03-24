import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import TravelImportClient from "@/components/admin/conference/TravelImportClient";

export const metadata = {
  title: "Travel Import | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceTravelImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <main className="p-6 text-sm text-red-700">Admin access required.</main>;
  }

  const { id: conferenceId } = await params;
  const adminClient = createAdminClient();
  const { data: conference } = (await adminClient
    .from("conference_instances")
    .select("id, name, year, edition_code")
    .eq("id", conferenceId)
    .maybeSingle()) as { data: { id: string; name: string; year: number; edition_code: string } | null };

  if (!conference) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Travel Import</h1>
          <p className="mt-1 text-sm text-gray-600">
            {conference.name} ({conference.year}-{conference.edition_code})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/conference/${conferenceId}/war-room`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to War Room
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to Conference
          </Link>
        </div>
      </div>

      <TravelImportClient conferenceId={conferenceId} />
    </main>
  );
}
