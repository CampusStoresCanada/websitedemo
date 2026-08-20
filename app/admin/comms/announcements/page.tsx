import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AnnouncementReview from "@/components/admin/AnnouncementReview";
import { listAnnouncements } from "@/lib/actions/ghost-announcements";

export const metadata = { title: "New Partner Announcements | Admin" };
export const dynamic = "force-dynamic";

export default async function AnnouncementsAdminPage() {
  const announcements = await listAnnouncements();

  return (
    <main>
      <AdminPageHeader
        title="New Partner Announcements"
        description="Helpful Ghost drafts an introduction when a partner completes onboarding and pays. Nothing is posted until you approve it — and approving several at once still releases them one per business day."
      />
      <AnnouncementReview initial={announcements} />
    </main>
  );
}
