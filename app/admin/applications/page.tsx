import { createClient } from "@/lib/supabase/server";
import { ApplicationsReview } from "@/components/admin/ApplicationsReview";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Applications | Admin" };

export default async function ApplicationsAdminPage() {
  const supabase = await createClient();
  const { data: applications } = await supabase
    .from("signup_applications")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main>
      <AdminPageHeader
        title="Applications"
        description="Review pending membership and partner applications."
      />
      <ApplicationsReview initialApplications={applications ?? []} />
    </main>
  );
}
