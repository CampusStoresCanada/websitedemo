import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import OrgDirectory from "@/components/admin/OrgDirectory";

export const metadata = { title: "Membership | Admin" };

export default async function MembershipAdminPage() {
  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, type, city, province, country, membership_status, membership_expires_at, fte, payment_status, created_at, onboarding_completed_at"
    )
    .order("name");

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Membership</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage member and partner organizations, renewals, and billing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/applications"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Applications
          </Link>
          <Link
            href="/admin/policy"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Billing Policy
          </Link>
          <Link
            href="/benchmarking/admin"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Benchmarking
          </Link>
        </div>
      </div>
      <OrgDirectory initialOrgs={orgs ?? []} />
    </main>
  );
}
