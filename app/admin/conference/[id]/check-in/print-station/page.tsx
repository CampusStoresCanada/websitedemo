import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import PrintStationClient from "@/components/admin/conference/PrintStationClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print station | Check-in" };

/** Where build_app.sh's zip is uploaded (private bucket). */
const PRINT_STATION_APP_PATH = "software/csc-print-station-mac.zip";

/**
 * The laptop beside the Brother QL: it prints what any desk device sends with
 * "Send to print queue". Desk staff open it; it needs nothing installed beyond
 * the printer's driver.
 */
export default async function PrintStationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;
  const db = createAdminClient();
  const [{ data: conference }, appLink] = await Promise.all([
    db.from("conference_instances").select("name").eq("id", id).maybeSingle(),
    // The Mac app, from private storage: a link that works for the next hour,
    // made for whoever is allowed on this page. Build and upload: print-station/README.md.
    db.storage.from("brand-assets").createSignedUrl(PRINT_STATION_APP_PATH, 60 * 60, {
      download: "CSC Print Station.zip",
    }),
  ]);
  return (
    <PrintStationClient
      conferenceId={id}
      conferenceName={(conference?.name as string | null) ?? "Conference"}
      macAppUrl={appLink.data?.signedUrl ?? null}
    />
  );
}
