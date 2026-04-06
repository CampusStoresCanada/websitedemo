import { createClient } from "@/lib/supabase/server";
import { ApplicationsReview } from "@/components/admin/ApplicationsReview";

export const metadata = { title: "Applications | Admin" };

export default async function ApplicationsAdminPage() {
  const supabase = await createClient();
  const { data: applications } = await supabase
    .from("signup_applications")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main>
      <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
      <p className="mt-2 text-sm text-gray-600">
        Review pending membership and partner applications.
      </p>
      <div className="mt-6">
        <ApplicationsReview initialApplications={applications ?? []} />
      </div>
    </main>
  );
}
