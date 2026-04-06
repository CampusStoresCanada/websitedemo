import RegistrationsTable from "@/components/admin/conference/RegistrationsTable";

export const metadata = { title: "Conference Registrations | Admin" };

export default async function ConferenceRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RegistrationsTable conferenceId={id} />;
}
