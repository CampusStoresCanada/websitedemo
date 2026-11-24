import RegistrationsList from "@/components/admin/conference/RegistrationsList";
import FundedConversionPanel from "@/components/admin/conference/FundedConversionPanel";
import { getFundedConversionBoard } from "@/lib/actions/conference-funded-conversion";
import { getCancollBillingSummary } from "@/lib/actions/cancoll-billing";
import { getRegistrationChangeRows } from "@/lib/actions/conference-registration-change";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRegistrationList, summarizeSide } from "@/lib/conference/registration-list";

export const metadata = { title: "Conference Registrations | Admin" };

export default async function ConferenceRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <main className="max-w-3xl mx-auto py-12 px-4 text-gray-600">Admins only.</main>;
  }
  const { id } = await params;
  // Only a conference with a CANCOLL-funded registration shows the panel.
  const [seats, board, billing, changes] = await Promise.all([
    loadRegistrationList(createAdminClient(), id),
    getFundedConversionBoard(id),
    getCancollBillingSummary(id),
    getRegistrationChangeRows(id),
  ]);
  return (
    <>
      <RegistrationsList
        conferenceId={id}
        delegates={summarizeSide(seats, "delegate")}
        exhibitors={summarizeSide(seats, "exhibitor")}
        changeRows={changes.success ? changes.data : []}
      />
      {board.success && board.data && <FundedConversionPanel conferenceId={id} board={board.data} billing={billing.success ? billing.data : null} />}
      <p className="text-sm text-gray-600">
        Exports of the people attending are in the{" "}
        <a href={`/admin/conference/${id}/war-room?tab=data`} className="font-medium text-accent hover:underline">
          War Room&apos;s Data tab
        </a>
        .
      </p>
    </>
  );
}
