import { getConference } from "@/lib/actions/conference";
import StatusControls from "@/components/admin/conference/StatusControls";

export const metadata = { title: "Status Controls | Admin" };

export default async function ConferenceStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }

  return <StatusControls conference={result.data} />;
}
