import { getConference } from "@/lib/actions/conference";
import ConferenceSubNav from "@/components/admin/conference/ConferenceSubNav";

export default async function ConferenceDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConference(id);

  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Conference not found. {result.error}
      </div>
    );
  }

  const conference = result.data;

  return (
    <div>
      <ConferenceSubNav
        conferenceId={conference.id}
        conferenceName={conference.name}
        year={conference.year}
        editionCode={conference.edition_code}
      />
      {children}
    </div>
  );
}
