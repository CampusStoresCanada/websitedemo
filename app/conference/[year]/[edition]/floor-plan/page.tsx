import Link from "next/link";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getFloorPlanForVisitor } from "@/lib/actions/conference-entities";
import { getConferenceMembershipGateInfo } from "@/lib/actions/conference-commerce";
import { createAdminClient } from "@/lib/supabase/admin";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import FloorPlanViewer from "./floor-plan-viewer";

interface OrgMembership { id: string; name: string; }

export const dynamic = "force-dynamic";
export const metadata = { title: "Floor Plan" };

/**
 * Deliberately public — booths are one of the things meant to be freely
 * buyable by a brand-new prospect (pay-first, then join CSC via the partner
 * application). getViewerContext() falls back to an anonymous viewer rather
 * than requiring a session, same pattern as the /exhibit entry point.
 */
export default async function ConferenceFloorPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { year, edition } = await params;
  const query = await searchParams;

  const viewer = await getViewerContext();
  const canPreviewUnpublished =
    viewer.viewerLevel === "admin" ||
    viewer.viewerLevel === "super_admin" ||
    hasDraftPreviewAccess(viewer.viewerOrgIds);

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code, status")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && PUBLIC_CONFERENCE_STATUSES.includes(conference.status as (typeof PUBLIC_CONFERENCE_STATUSES)[number]);

  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const { data: userOrgs } = viewer.userId
    ? await db
        .from("user_organizations")
        .select("organization_id, organizations(id, name)")
        .eq("user_id", viewer.userId)
        .eq("status", "active")
    : { data: null };
  const memberships = (userOrgs ?? []).map(
    r => (r as unknown as { organizations: OrgMembership }).organizations
  );
  const selectedOrg = memberships.find(o => o.id === query.org) ?? memberships[0] ?? null;

  const [floorResult, orgCartRes, membershipGateResult] = await Promise.all([
    getFloorPlanForVisitor(conference.id),
    // Load this org's active cart items so the viewer can highlight "your booth".
    selectedOrg
      ? db.from("cart_items")
          .select("offer_entity_id")
          .eq("conference_id", conference.id)
          .eq("organization_id", selectedOrg.id)
          .not("offer_entity_id", "is", null)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      : Promise.resolve({ data: [] }),
    selectedOrg
      ? getConferenceMembershipGateInfo({ conferenceId: conference.id, organizationId: selectedOrg.id })
      : Promise.resolve(null),
  ]);
  const myCartOfferIds = new Set(
    (orgCartRes.data ?? []).map(r => r.offer_entity_id).filter(Boolean) as string[]
  );
  const membershipGate =
    membershipGateResult?.success && membershipGateResult.data.gated && !membershipGateResult.data.coversConference
      ? {
          previewPriceCents: membershipGateResult.data.previewPriceCents,
          newExpiresAt: membershipGateResult.data.newExpiresAt,
        }
      : null;

  return (
    <main className="max-w-6xl mx-auto py-8 px-4 space-y-4">
      {isDraftPreview && <DraftPreviewBanner status={conference.status} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name} — Floor Plan</h1>
          {selectedOrg ? (
            <p className="text-sm text-gray-600">Buying for <strong>{selectedOrg.name}</strong></p>
          ) : (
            <p className="text-sm text-gray-600">
              New to Campus Stores Canada? Reserve a booth below — payment also starts your
              partnership application, which the board reviews afterward.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/conference/${year}/${edition}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400">
            Back
          </Link>
        </div>
      </div>

      {memberships.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {memberships.map(org => (
            <Link key={org.id} href={`/conference/${year}/${edition}/floor-plan?org=${org.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                org.id === selectedOrg?.id
                  ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}>
              {org.name}
            </Link>
          ))}
        </div>
      ) : null}

      {!floorResult.success || !floorResult.data.floorPlanUrl ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          {!floorResult.success ? floorResult.error : "No floor plan has been published yet."}
        </div>
      ) : (
        <FloorPlanViewer
          conferenceId={conference.id}
          conferenceYear={year}
          conferenceEdition={edition}
          organizationId={selectedOrg?.id ?? null}
          floorPlanUrl={floorResult.data.floorPlanUrl}
          booths={floorResult.data.booths}
          myCartOfferIds={myCartOfferIds}
          membershipGate={membershipGate}
        />
      )}
    </main>
  );
}
