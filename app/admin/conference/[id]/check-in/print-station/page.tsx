import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import PrintStationClient from "@/components/admin/conference/PrintStationClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print station | Check-in" };

/**
 * The laptop beside the Brother QL: it prints what any desk device sends with
 * "Send to print queue". Desk staff open it; it needs nothing installed beyond
 * the printer's driver.
 */
export default async function PrintStationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;
  const { data: conference } = await createAdminClient()
    .from("conference_instances")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return <PrintStationClient conferenceId={id} conferenceName={(conference?.name as string | null) ?? "Conference"} />;
}
