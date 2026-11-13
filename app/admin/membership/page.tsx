import Link from "next/link";
import { getRenewalDirectory } from "@/lib/renewal/renewal-directory";
import { RenewalsDirectory } from "@/components/admin/RenewalsDirectory";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AddProspectCompany from "@/components/admin/AddProspectCompany";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROSPECT_ORG_TYPES } from "@/lib/constants/org-types";

export const metadata = { title: "Membership | Admin" };
export const dynamic = "force-dynamic";

export default async function MembershipAdminPage() {
  const [{ rows, programs }, { data: prospectRows }] = await Promise.all([
    getRenewalDirectory(),
    createAdminClient()
      .from("organizations")
      .select("name, slug, type")
      .in("type", [...PROSPECT_ORG_TYPES])
      .order("name"),
  ]);
  const prospects = ((prospectRows ?? []) as Array<{ name: string; slug: string | null; type: string }>)
    .filter((p): p is { name: string; slug: string; type: string } => !!p.slug);

  return (
    <main>
      <AdminPageHeader
        title="Membership"
        description="Manage member and partner organizations, renewals, and billing."
        actions={
          <>
            <AddProspectCompany prospects={prospects} />
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
