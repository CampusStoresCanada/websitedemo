import Link from "next/link";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMemberDirectory } from "@/lib/conference/member-directory";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import MemberDirectory from "@/components/conference/MemberDirectory";

export const dynamic = "force-dynamic";

/**
 * Who is on the floor, browsable by what they sell. The map's other half, and
 * the screen equivalent of the printed directory — same orgs, same booth
 * numbers, same categories, sourced from real purchases rather than the
 * for-sale catalogue.
 */
export default async function ConferenceDirectoryPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const viewer = await getViewerContext();
  const canPreviewUnpublished =
    viewer.viewerLevel === "admin" ||
    viewer.viewerLevel === "super_admin" ||
    hasDraftPreviewAccess(viewer.viewerOrgIds);

  const { data: conference } = await createAdminClient()
    .from("conference_instances")
    .select("id, name, year, edition_code, status")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference &&
    VISIBLE_CONFERENCE_STATUSES.includes(
      conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]
    );

  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }

  const { listings, departments } = await loadMemberDirectory(conference.id);
  const mapHref = `/conference/${conference.year}/${conference.edition_code}/map`;

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      {canPreviewUnpublished && !isPublicStatus && (
        <DraftPreviewBanner status={conference.status} />
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">
          {conference.name} — Exhibitors
        </h1>
        <Link href={mapHref} className="text-sm font-medium text-[#163D6D] hover:underline">
          Map &rarr;
        </Link>
      </div>

      <MemberDirectory listings={listings} departments={departments} mapHref={mapHref} />
    </main>
  );
}
