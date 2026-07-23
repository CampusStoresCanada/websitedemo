import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { getConferenceCart } from "@/lib/actions/conference-commerce";
import { listEntitySeatsForOrg } from "@/lib/actions/conference-entity-commerce";
import { getContactsForOrganization, getOrganizations } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import CartClient from "./cart-client";

interface OrganizationMembership {
  id: string;
  name: string;
  slug: string;
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
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);

  const { data: userOrgs } = await adminClient
    .from("user_organizations")
    .select("organization_id, organizations(id, name, slug)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const memberships = (userOrgs ?? []).map(
    (row) => (row as unknown as { organizations: OrganizationMembership }).organizations
  );

  const allOrgs = isAdmin ? await getOrganizations() : [];
  const orgOptions: OrganizationMembership[] = isAdmin
    ? allOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))
    : memberships;

  if (orgOptions.length === 0) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-gray-600">
          You need an active organization membership to access conference cart.
        </p>
      </main>
    );
  }

  const selectedOrg = orgOptions.find((org) => org.id === query.org) ?? (isAdmin ? null : orgOptions[0]);

  if (!selectedOrg) {
    return (
      <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={null} basePath={`/conference/${year}/${edition}/cart`} />
        <p className="text-sm text-gray-600">Pick an organization above to view their cart.</p>
      </main>
    );
  }

  const [cartResult, orgContacts, orgSeatsResult] = await Promise.all([
    getConferenceCart(conference.id, selectedOrg.id),
    getContactsForOrganization(selectedOrg.id),
    // Org-admin+ only (listEntitySeatsForOrg's own guard) — a plain member's
    // cart just won't get the "you already have an open seat" nudge below,
    // rather than erroring the whole page.
    listEntitySeatsForOrg(conference.id, selectedOrg.id),
  ]);
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
      {conferenceResult.isDraftPreview && <DraftPreviewBanner status={conference.status} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Conference cart</p>
        </div>
        <Link
          href={`/conference/${year}/${edition}`}
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:border-gray-400"
        >
          Back to Conference
        </Link>
      </div>

      {isAdmin ? (
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={selectedOrg.id} basePath={`/conference/${year}/${edition}/cart`} />
      ) : memberships.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {memberships.map((org) => (
            <Link
              key={org.id}
              href={`/conference/${year}/${edition}/cart?org=${org.id}`}
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

      <CartClient
        conferenceId={conference.id}
        conferenceYear={year}
        conferenceEdition={edition}
        organizationId={selectedOrg.id}
        organizationName={selectedOrg.name}
        orgSlug={selectedOrg.slug}
        isDevAdmin={isAdmin}
        initialCart={cartResult.data}
        contacts={orgContacts.map((c) => ({ id: c.id, name: c.name ?? "", email: c.work_email ?? c.email ?? null }))}
        orgSeats={orgSeatsResult.success ? orgSeatsResult.data : []}
      />
    </main>
  );
}
