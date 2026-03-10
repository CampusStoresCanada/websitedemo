import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getConferenceCart } from "@/lib/actions/conference-commerce";
import { createAdminClient } from "@/lib/supabase/admin";
import CartClient from "./cart-client";

interface OrganizationMembership {
  id: string;
  name: string;
}

export const metadata = { title: "Conference Cart" };

export default async function ConferenceCartPage({
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
        <h1 className="text-2xl font-semibold text-gray-900">Conference Not Found</h1>
        <p className="mt-2 text-sm text-gray-600">This conference cart could not be loaded.</p>
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
        <p className="mt-2 text-sm text-gray-600">
          You need an active organization membership to access conference cart.
        </p>
      </main>
    );
  }

  const selectedOrg = memberships.find((org) => org.id === query.org) ?? memberships[0];
  const cartResult = await getConferenceCart(conference.id, selectedOrg.id);
  if (!cartResult.success) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-red-600">{cartResult.error}</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Conference cart</p>
        </div>
        <Link
          href={`/conference/${year}/${edition}/products?org=${selectedOrg.id}`}
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:border-gray-400"
        >
          Back to Products
        </Link>
      </div>

      {memberships.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {memberships.map((org) => (
            <Link
              key={org.id}
              href={`/conference/${year}/${edition}/cart?org=${org.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                org.id === selectedOrg.id
                  ? "border-[#D60001] bg-[#fff1f1] text-[#D60001]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {org.name}
            </Link>
          ))}
        </div>
      ) : null}

      <CartClient
        conferenceId={conference.id}
        conferenceYear={year}
        conferenceEdition={edition}
        organizationId={selectedOrg.id}
        organizationName={selectedOrg.name}
        initialCart={cartResult.data}
      />
    </main>
  );
}
