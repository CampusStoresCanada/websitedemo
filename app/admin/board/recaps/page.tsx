import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BoardRecapReview from "@/components/admin/board/BoardRecapReview";
import { listBoardRecaps } from "@/lib/actions/board-recaps";

export const metadata = { title: "Board Recaps | Admin" };
export const dynamic = "force-dynamic";

export default async function BoardRecapsAdminPage() {
  const recaps = await listBoardRecaps();

  return (
    <main>
      <AdminPageHeader
        title="Board Recaps"
        description="Butler Ghost drafts a recap whenever board minutes are saved with DECIDED, OUTSTANDING or NEXT MEETING lines. Those lines are removed from the minutes once they are drafted here — this is the only copy, and the place to correct them. Nothing posts to the board space until you approve it."
      />
      <BoardRecapReview initial={recaps} />
    </main>
  );
}
