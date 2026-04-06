import {
  listSwapRequests,
  listSwapCapIncreaseRequests,
} from "@/lib/actions/conference-swaps";
import SwapRequestsPanel from "@/components/admin/conference/SwapRequestsPanel";

export const metadata = { title: "Swap Requests | Admin" };

export default async function ConferenceSwapsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [swapsResult, capResult] = await Promise.all([
    listSwapRequests(id),
    listSwapCapIncreaseRequests(id),
  ]);

  return (
    <SwapRequestsPanel
      conferenceId={id}
      initialSwapRequests={swapsResult.success ? swapsResult.data : []}
      initialCapIncreaseRequests={capResult.success ? capResult.data : []}
    />
  );
}
