import { getConference } from "@/lib/actions/conference";
import ConferenceRulesBuilder from "@/components/admin/conference/ConferenceRulesBuilder";

export const metadata = { title: "Conference Rules | Admin" };

export default async function ConferenceRulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConference(id);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }

  return (
    <ConferenceRulesBuilder
      conferenceId={result.data.id}
      products={result.data.conference_products ?? []}
    />
  );
}
