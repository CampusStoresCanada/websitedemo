import { createClient } from "@/lib/supabase/server";
import { getServerAuthState } from "@/lib/auth/server";
import { ApplicationsReview } from "@/components/admin/ApplicationsReview";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { getVoteSummaries } from "@/lib/board/vote-service";

export const metadata = { title: "Applications | Admin" };

export default async function ApplicationsAdminPage() {
  const supabase = await createClient();
  const [{ data: applications }, authState] = await Promise.all([
    supabase
      .from("signup_applications")
      .select("*")
      .order("created_at", { ascending: false }),
    getServerAuthState(),
  ]);

  // Board-vote standing for every application shown, so staff can see whether
  // the board has spoken before approving.
  const voteSummaries = await getVoteSummaries((applications ?? []).map((a) => a.id as string));

  return (
    <main>
      <AdminPageHeader
        title="Applications"
        description="Review pending membership and partner applications."
      />
      <ApplicationsReview
        initialApplications={applications ?? []}
        isSuperAdmin={authState.globalRole === "super_admin"}
        voteSummaries={Object.fromEntries(voteSummaries)}
      />
    </main>
  );
}
