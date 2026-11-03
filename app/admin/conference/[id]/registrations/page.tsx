import RegistrationsTable from "@/components/admin/conference/RegistrationsTable";
import FundedConversionPanel from "@/components/admin/conference/FundedConversionPanel";
import { getFundedConversionBoard } from "@/lib/actions/conference-funded-conversion";

export const metadata = { title: "Conference Registrations | Admin" };

export default async function ConferenceRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Only a conference with a CANCOLL-funded registration shows the panel.
  const board = await getFundedConversionBoard(id);
  return (
    <>
      {board.success && board.data && <FundedConversionPanel conferenceId={id} board={board.data} />}
      <RegistrationsTable conferenceId={id} />
    </>
  );
}
