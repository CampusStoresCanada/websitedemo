import { getConference } from "@/lib/actions/conference";
import { isSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import {
  listBillingRunsForConference,
  listWishlistBillingAttemptsForConference,
  listWishlistIntentsForConference,
} from "@/lib/actions/conference-commerce";
import {
  listSwapCapIncreaseRequests,
  listSwapRequests,
} from "@/lib/actions/conference-swaps";
import {
  listConferenceExhibitorOrganizations,
  listConferenceScheduleModules,
} from "@/lib/actions/conference-schedule-design";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import ConferenceDashboard from "@/components/admin/conference/ConferenceDashboard";

export const metadata = { title: "Conference Dashboard | Admin" };

export default async function ConferenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireAdmin();
  const canSuperAdminOverride = auth.ok ? isSuperAdmin(auth.ctx.globalRole) : false;
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Conference not found. {result.error}
      </div>
    );
  }
  const [
    wishlistResult,
    billingRunsResult,
    billingAttemptsResult,
    swapRequestsResult,
    swapCapRequestsResult,
    scheduleTimeline,
    scheduleModulesResult,
    exhibitorOrganizationsResult,
  ] = await Promise.all([
    listWishlistIntentsForConference({ conferenceId: id }),
    listBillingRunsForConference({ conferenceId: id, limit: 25 }),
    listWishlistBillingAttemptsForConference({ conferenceId: id, limit: 50 }),
    listSwapRequests(id),
    listSwapCapIncreaseRequests(id),
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    listConferenceScheduleModules(id),
    listConferenceExhibitorOrganizations(id),
  ]);

  return (
    <ConferenceDashboard
      conference={result.data}
      initialWishlistRows={wishlistResult.success ? wishlistResult.data : []}
      initialBillingRuns={billingRunsResult.success ? billingRunsResult.data : []}
      initialBillingAttempts={billingAttemptsResult.success ? billingAttemptsResult.data : []}
      initialSwapRequests={swapRequestsResult.success ? swapRequestsResult.data : []}
      initialSwapCapIncreaseRequests={
        swapCapRequestsResult.success ? swapCapRequestsResult.data : []
      }
      canSuperAdminOverride={canSuperAdminOverride}
      googleMapsApiKey={googleMapsApiKey}
      initialProgramItems={scheduleTimeline.programItems.map((item) => ({
        id: item.id,
        conference_id: item.conferenceId,
        item_type: item.itemType,
        title: item.title,
        description: item.description,
        starts_at: item.startsAt,
        ends_at: item.endsAt,
        location_label: item.locationLabel,
        audience_mode: item.audienceMode,
        target_roles: item.targetRoles,
        is_required: item.isRequired,
        display_order: item.displayOrder,
        created_at: item.createdAt ?? item.startsAt,
        updated_at: item.updatedAt ?? item.endsAt,
      }))}
      initialScheduleModules={
        scheduleModulesResult.success ? scheduleModulesResult.data ?? [] : []
      }
      initialExhibitorOrganizations={
        exhibitorOrganizationsResult.success ? exhibitorOrganizationsResult.data ?? [] : []
      }
    />
  );
}
