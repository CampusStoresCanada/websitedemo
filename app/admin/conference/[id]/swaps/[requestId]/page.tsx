import { redirect } from "next/navigation";
import { getSwapRequest } from "@/lib/actions/conference-swaps";

export const metadata = { title: "Swap Request Detail | Admin" };

export default async function SwapRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const result = await getSwapRequest(id, requestId);

  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Swap request not found.
      </div>
    );
  }

  // For now, redirect to the swaps list — the panel handles detail inline.
  // This route exists so deep-links are bookmarkable and future detail views have a home.
  redirect(`/admin/conference/${id}/swaps`);
}
