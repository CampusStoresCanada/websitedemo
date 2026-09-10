import Link from "next/link";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMemberMap } from "@/lib/conference/member-map";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import MemberMap from "@/components/conference/MemberMap";

export const dynamic = "force-dynamic";

/**
 * The member's map. Sits beside /floor-plan, which sells booths, on the same
 * placement model — two viewers, one set of coordinates.
 *
 * Same visibility rule as its sibling: a conference nobody can see yet is
 * previewable by CSC staff and draft-preview orgs, and by nobody else. The map
 * itself carries no per-viewer filtering, because a floor plan showing who is
 * in which booth is exactly what gets printed in the book and handed out at
 * the door.
 */
export default async function ConferenceMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  searchParams: Promise<{ find?: string }>;
}) {
  const { year, edition } = await params;
  const { find } = await searchParams;
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

  const { surfaces, things } = await loadMemberMap(conference.id);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      {canPreviewUnpublished && !isPublicStatus && (
        <DraftPreviewBanner status={conference.status} />
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">{conference.name} — Map</h1>
        <Link
          href={`/conference/${conference.year}/${conference.edition_code}/directory`}
          className="text-sm font-medium text-[#163D6D] hover:underline"
        >
          Exhibitor list &rarr;
        </Link>
      </div>

      <MemberMap surfaces={surfaces} things={things} initialQuery={find ?? ""} />
    </main>
  );
}
