import { getAdminSiteContent } from "@/lib/actions/site-content";
import ContentManager from "@/components/admin/content/ContentManager";

export const metadata = {
  title: "Site Content | Admin | Campus Stores Canada",
};

export default async function AdminContentPage() {
  const [boardResult, staffResult] = await Promise.all([
    getAdminSiteContent("board_of_directors"),
    getAdminSiteContent("staff"),
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
    />
  );
}
