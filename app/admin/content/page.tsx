import { getAdminSiteContent } from "@/lib/actions/site-content";
import { listPendingChanges } from "@/lib/actions/pending-content-changes";
import ContentManager from "@/components/admin/content/ContentManager";

export const metadata = {
  title: "Site Content | Admin | Campus Stores Canada",
};

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const initialTab = params.tab === "pending" ? "pending" : undefined;

  const [boardResult, staffResult, pendingResult] = await Promise.all([
    getAdminSiteContent("board_of_directors"),
    getAdminSiteContent("staff"),
    listPendingChanges({ limit: 50 }),
  ]);

  if (!boardResult.success || !staffResult.success) {
    return (
      <div className="text-center py-12">
        <p className="text-[#6B6B6B]">
          Failed to load content data: {boardResult.error || staffResult.error}
        </p>
      </div>
    );
  }

  return (
    <ContentManager
      boardMembers={boardResult.data || []}
      staffMembers={staffResult.data || []}
      pendingChanges={pendingResult.changes ?? []}
      initialTab={initialTab}
    />
  );
}
