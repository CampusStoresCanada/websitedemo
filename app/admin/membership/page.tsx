import Link from "next/link";
import { getRenewalDirectory } from "@/lib/renewal/renewal-directory";
import { RenewalsDirectory } from "@/components/admin/RenewalsDirectory";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Membership | Admin" };
export const dynamic = "force-dynamic";

export default async function MembershipAdminPage() {
  const { rows, programs } = await getRenewalDirectory();

  return (
    <main>
      <AdminPageHeader
        title="Membership"
        description="Manage member and partner organizations, renewals, and billing."
        actions={
          <>
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
          </>
        }
      />
      <RenewalsDirectory rows={rows} programs={programs} />
    </main>
  );
}
