import RegistrationsTable from "@/components/admin/conference/RegistrationsTable";
import FundedConversionPanel from "@/components/admin/conference/FundedConversionPanel";
import { getFundedConversionBoard } from "@/lib/actions/conference-funded-conversion";
import { getCancollBillingSummary } from "@/lib/actions/cancoll-billing";

export const metadata = { title: "Conference Registrations | Admin" };

export default async function ConferenceRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Only a conference with a CANCOLL-funded registration shows the panel.
  const [board, billing] = await Promise.all([getFundedConversionBoard(id), getCancollBillingSummary(id)]);
  return (
    <>
      {board.success && board.data && <FundedConversionPanel conferenceId={id} board={board.data} billing={billing.success ? billing.data : null} />}
      <RegistrationsTable conferenceId={id} />
    </>
  );
}
