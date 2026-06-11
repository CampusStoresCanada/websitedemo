import { getConference } from "@/lib/actions/conference";
import { listConferenceScheduleModules } from "@/lib/actions/conference-schedule-design";
import { getAdminBoothOverview } from "@/lib/actions/conference-booths";
import { createAdminClient } from "@/lib/supabase/admin";
import ScheduleDesignWizard from "@/components/admin/conference/ScheduleDesignWizard";

export const metadata = { title: "Conference Setup | Admin" };

export default async function ConferenceSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
  const [result, modulesResult, boothsResult] = await Promise.all([
    getConference(id),
    listConferenceScheduleModules(id),
    getAdminBoothOverview(id),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  const conference = result.data;
  const conferenceParams = conference.conference_parameters?.[0] ?? null;

  const db = createAdminClient();
  const { data: vendorOrgRows } = await db
    .from("organizations")
    .select("id, name, type")
    .order("name");

  const vendorOrgs = (vendorOrgRows ?? [])
    .filter((o) => {
      const t = (o.type ?? "").toLowerCase();
      return t === "vendor_partner" || t === "vendor partner";
    })
    .map((o) => ({ id: o.id, name: o.name }));

  return (
    <ScheduleDesignWizard
      conferenceId={conference.id}
      params={conferenceParams}
      initialModules={modulesResult.success ? modulesResult.data ?? [] : []}
      conferenceStartDate={conference.start_date}
      conferenceEndDate={conference.end_date}
      conferenceRegistrationOpenAt={conference.registration_open_at}
      conferenceRegistrationCloseAt={conference.registration_close_at}
      googleMapsApiKey={googleMapsApiKey}
      initialProducts={conference.conference_products ?? []}
      floorPlanUrl={conference.floor_plan_url}
      initialBooths={boothsResult.success ? boothsResult.data ?? [] : []}
      vendorOrgs={vendorOrgs}
      conferenceYear={conference.year}
      editionCode={conference.edition_code}
    />
  );
}
