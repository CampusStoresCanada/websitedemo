import { getConference } from "@/lib/actions/conference";
import ConferenceOverview from "@/components/admin/conference/ConferenceOverview";

export const metadata = { title: "Conference Overview | Admin" };

export default async function ConferenceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  const conference = result.data;
  const params0 = conference.conference_parameters?.[0] ?? null;
  const productCount = conference.conference_products?.length ?? 0;

  return <ConferenceOverview conference={conference} params={params0} productCount={productCount} />;
}
