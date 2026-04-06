import {
  listBillingRunsForConference,
  listWishlistBillingAttemptsForConference,
} from "@/lib/actions/conference-commerce";
import BillingRunsPanel from "@/components/admin/conference/BillingRunsPanel";

export const metadata = { title: "Billing Run Detail | Admin" };

export default async function BillingRunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const [runsResult, attemptsResult] = await Promise.all([
    listBillingRunsForConference({ conferenceId: id, limit: 25 }),
    listWishlistBillingAttemptsForConference({ conferenceId: id, limit: 50 }),
  ]);

  // Filter attempts to just this run for the initial view
  const allRuns = runsResult.success ? runsResult.data : [];
  const allAttempts = attemptsResult.success ? attemptsResult.data : [];
  const runExists = allRuns.some((r) => r.id === runId);

  if (!runExists) {
    return (
      <div className="text-center py-12 text-gray-500">
        Billing run not found. It may have been deleted.
      </div>
    );
  }

  return (
    <BillingRunsPanel
      conferenceId={id}
      initialRuns={allRuns}
      initialAttempts={allAttempts.filter((a) => a.billing_run_id === runId)}
    />
  );
}
