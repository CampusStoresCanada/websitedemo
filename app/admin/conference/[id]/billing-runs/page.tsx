import {
  listBillingRunsForConference,
  listWishlistBillingAttemptsForConference,
} from "@/lib/actions/conference-commerce";
import BillingRunsPanel from "@/components/admin/conference/BillingRunsPanel";

export const metadata = { title: "Billing Runs | Admin" };

export default async function ConferenceBillingRunsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [runsResult, attemptsResult] = await Promise.all([
    listBillingRunsForConference({ conferenceId: id, limit: 25 }),
    listWishlistBillingAttemptsForConference({ conferenceId: id, limit: 50 }),
  ]);

  return (
    <BillingRunsPanel
      conferenceId={id}
      initialRuns={runsResult.success ? runsResult.data : []}
      initialAttempts={attemptsResult.success ? attemptsResult.data : []}
    />
  );
}
