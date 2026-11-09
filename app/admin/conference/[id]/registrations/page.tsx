import RegistrationsTable from "@/components/admin/conference/RegistrationsTable";
import FundedConversionPanel from "@/components/admin/conference/FundedConversionPanel";
import RegistrationChangePanel from "@/components/admin/conference/RegistrationChangePanel";
import { getFundedConversionBoard } from "@/lib/actions/conference-funded-conversion";
import { getCancollBillingSummary } from "@/lib/actions/cancoll-billing";
import { getRegistrationChangeRows } from "@/lib/actions/conference-registration-change";

export const metadata = { title: "Conference Registrations | Admin" };

export default async function ConferenceRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Only a conference with a CANCOLL-funded registration shows the panel.
  const [board, billing, changes] = await Promise.all([
    getFundedConversionBoard(id),
    getCancollBillingSummary(id),
    getRegistrationChangeRows(id),
  ]);
  return (
    <>
      {changes.success && <RegistrationChangePanel conferenceId={id} rows={changes.data} />}
      {board.success && board.data && <FundedConversionPanel conferenceId={id} board={board.data} billing={billing.success ? billing.data : null} />}
      <RegistrationsTable conferenceId={id} />
    </>
  );
}
