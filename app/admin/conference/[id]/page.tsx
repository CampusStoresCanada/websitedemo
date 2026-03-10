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
import { listConferenceProgramItems } from "@/lib/actions/conference-program";
import {
  listConferenceExhibitorOrganizations,
  listConferenceScheduleModules,
} from "@/lib/actions/conference-schedule-design";
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
  const [
    result,
    wishlistResult,
    billingRunsResult,
    billingAttemptsResult,
    swapRequestsResult,
    swapCapRequestsResult,
    programItemsResult,
    scheduleModulesResult,
    exhibitorOrganizationsResult,
  ] = await Promise.all([
    getConference(id),
    listWishlistIntentsForConference({ conferenceId: id }),
    listBillingRunsForConference({ conferenceId: id, limit: 25 }),
    listWishlistBillingAttemptsForConference({ conferenceId: id, limit: 50 }),
    listSwapRequests(id),
    listSwapCapIncreaseRequests(id),
    listConferenceProgramItems(id),
    listConferenceScheduleModules(id),
    listConferenceExhibitorOrganizations(id),
  ]);

  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Conference not found. {result.error}
      </div>
    );
  }

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
      initialProgramItems={programItemsResult.success ? programItemsResult.data ?? [] : []}
      initialScheduleModules={
        scheduleModulesResult.success ? scheduleModulesResult.data ?? [] : []
      }
      initialExhibitorOrganizations={
        exhibitorOrganizationsResult.success ? exhibitorOrganizationsResult.data ?? [] : []
      }
    />
  );
}
