import { syncAndFetchCalendar } from "@/lib/calendar/aggregation";
import CalendarPageClient from "@/components/admin/calendar/CalendarPageClient";

export const metadata = {
  title: "Operational Calendar | Admin | Campus Stores Canada",
};

// Always fetch fresh — calendar is a live operational view.
export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function CalendarPage() {
  const { items, saturation, synced_at } = await syncAndFetchCalendar();

  return (
    <main>
      <CalendarPageClient
        items={items}
        saturation={saturation}
        syncedAt={synced_at}
      />
    </main>
  );
}
