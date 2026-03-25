import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { listConferenceOrdersForOrganization } from "@/lib/actions/conference-commerce";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCents } from "@/lib/utils";

interface OrganizationMembership {
  id: string;
  name: string;
}

export const metadata = { title: "Conference Orders" };

export default async function ConferenceOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { year, edition } = await params;
  const query = await searchParams;

  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const adminClient = createAdminClient();
  const { data: userOrgs } = await adminClient
    .from("user_organizations")
    .select("organization_id, organizations(id, name)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const memberships = (userOrgs ?? []).map(
    (row) => (row as unknown as { organizations: OrganizationMembership }).organizations
  );
  if (memberships.length === 0) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-gray-600">No active organization memberships found.</p>
      </main>
    );
  }

  const selectedOrg = memberships.find((org) => org.id === query.org) ?? memberships[0];
  const ordersResult = await listConferenceOrdersForOrganization({
    conferenceId: conference.id,
    organizationId: selectedOrg.id,
  });

  if (!ordersResult.success) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-red-600">{ordersResult.error}</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Conference order history</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/conference/${year}/${edition}/schedule`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Schedule
          </Link>
          <Link
            href={`/conference/${year}/${edition}/products?org=${selectedOrg.id}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Products
          </Link>
          <Link
            href={`/conference/${year}/${edition}/cart?org=${selectedOrg.id}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Cart
          </Link>
        </div>
      </div>

      {memberships.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {memberships.map((org) => (
            <Link
              key={org.id}
              href={`/conference/${year}/${edition}/orders?org=${org.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                org.id === selectedOrg.id
                  ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {org.name}
            </Link>
          ))}
        </div>
      ) : null}

      {ordersResult.data.length === 0 ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No orders yet</h2>
          <p className="mt-2 text-sm text-gray-600">Paid and pending orders for this org will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Subtotal</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Tax</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {ordersResult.data.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <Link
                      href={`/conference/${year}/${edition}/orders/${order.id}?org=${selectedOrg.id}`}
                      className="text-[#EE2A2E] hover:underline"
                    >
                      <Timestamp iso={order.created_at} format="compact" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{order.status}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatCents(order.subtotal_cents)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatCents(order.tax_cents)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCents(order.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
