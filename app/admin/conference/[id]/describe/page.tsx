import { getConference } from "@/lib/actions/conference";
import { getConferenceCatalog } from "@/lib/actions/conference-catalog";
import DescribeManager from "@/components/admin/conference/DescribeManager";

export const metadata = { title: "Days & Setup | Conference Admin" };

export default async function ConferenceDescribePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [conferenceResult, catalogResult] = await Promise.all([
    getConference(id),
    getConferenceCatalog(id),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  if (!catalogResult.success) {
    return (
      <div className="text-center py-12 text-gray-500">Failed to load catalog: {catalogResult.error}</div>
    );
  }

  const conference = conferenceResult.data;

  return (
    <DescribeManager
      conferenceId={conference.id}
      startDate={conference.start_date}
      endDate={conference.end_date}
      catalog={catalogResult.data}
    />
  );
}
