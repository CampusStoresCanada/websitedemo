import {
  listSwapRequests,
  listSwapCapIncreaseRequests,
} from "@/lib/actions/conference-swaps";
import SwapRequestsPanel from "@/components/admin/conference/SwapRequestsPanel";
import { isSuperAdmin, requireAuthenticated } from "@/lib/auth/guards";

export const metadata = { title: "Swap Requests | Admin" };

export default async function ConferenceSwapsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [swapsResult, capResult, auth] = await Promise.all([
    listSwapRequests(id),
    listSwapCapIncreaseRequests(id),
    requireAuthenticated(),
  ]);

  return (
    <SwapRequestsPanel
      conferenceId={id}
      canDecide={auth.ok && isSuperAdmin(auth.ctx.globalRole)}
      initialSwapRequests={swapsResult.success ? swapsResult.data : []}
      initialCapIncreaseRequests={capResult.success ? capResult.data : []}
    />
  );
}
