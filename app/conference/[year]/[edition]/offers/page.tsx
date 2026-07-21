import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import {
  listConferenceOffers,
  getPublicConferenceFloorPlan,
  type ConferenceFloorPlan,
} from "@/lib/actions/conference-entities";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizations } from "@/lib/data";
import OffersClient from "./offers-client";

interface OrganizationMembership {
  id: string;
  name: string;
  type: string | null;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Conference Offers" };

export default async function ConferenceOffersPage({
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
        <p className="mt-2 text-sm text-gray-600">This conference could not be loaded.</p>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const db = createAdminClient();
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);

  // Global admins can shop on behalf of ANY org, not just ones they belong to —
  // the commerce actions already permit this (isGlobalAdmin bypass), this is
  // the UI to reach it, e.g. for manually seeding a real registration to test.
  const { data: userOrgs } = await db
    .from("user_organizations")
    .select("organization_id, organizations(id, name, type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const memberships = (userOrgs ?? []).map(
    (row) => (row as unknown as { organizations: OrganizationMembership }).organizations
  );

  const allOrgs = isAdmin ? await getOrganizations() : [];
  const orgOptions: OrganizationMembership[] = isAdmin
    ? allOrgs.map((o) => ({ id: o.id, name: o.name, type: o.type }))
    : memberships;

  if (orgOptions.length === 0) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-gray-600">
          You need an active organization membership to buy for a conference.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Not a CSC member?{" "}
          <Link href={`/conference/${year}/${edition}/attend`} className="font-medium text-[#EE2A2E] hover:underline">
            Buy a single non-member Day Pass instead →
          </Link>
        </p>
      </main>
    );
  }

  const selectedOrg = orgOptions.find((org) => org.id === query.org) ?? (isAdmin ? null : orgOptions[0]);

  if (!selectedOrg) {
    return (
      <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={null} basePath={`/conference/${year}/${edition}/offers`} />
        <p className="text-sm text-gray-600">Pick an organization above to shop on their behalf.</p>
      </main>
    );
  }

  // Global admins (admin/super_admin) and partner-org buyers see the floor plan
  // inline — they're the ones buying booths. Everyone else gets the click-through.
  const isPartnerOrg = selectedOrg.type === "Vendor Partner";
  const canSeeMap = isAdmin || isPartnerOrg;

  // Parallel fetch: offers always; floor plan + cart only for map-eligible users.
  const [offersResult, floorResult, cartRes] = await Promise.all([
    listConferenceOffers(conference.id, selectedOrg.id),
    canSeeMap ? getPublicConferenceFloorPlan(conference.id) : Promise.resolve(null),
    canSeeMap
      ? db
          .from("cart_items")
          .select("offer_entity_id")
          .eq("conference_id", conference.id)
          .eq("organization_id", selectedOrg.id)
          .not("offer_entity_id", "is", null)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      : Promise.resolve({ data: [] }),
  ]);

  if (!offersResult.success) {
    return (
      <main className="max-w-5xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-red-600">{offersResult.error}</p>
      </main>
    );
  }

  const floorPlan: ConferenceFloorPlan | null =
    floorResult && "data" in floorResult && floorResult.data ? floorResult.data : null;
  const myCartOfferIds = new Set(
    ((cartRes as { data: Array<{ offer_entity_id: string | null }> | null }).data ?? [])
      .map((r) => r.offer_entity_id)
      .filter(Boolean) as string[]
  );

  return (
    <main className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {conferenceResult.isDraftPreview && <DraftPreviewBanner status={conference.status} />}

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="text-sm text-gray-600">Exhibit &amp; register — buy for {selectedOrg.name}</p>
      </div>

      {isAdmin ? (
        <AdminOrgSwitcher orgs={orgOptions} selectedOrgId={selectedOrg.id} basePath={`/conference/${year}/${edition}/offers`} />
      ) : memberships.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {memberships.map((org) => (
            <Link
              key={org.id}
              href={`/conference/${year}/${edition}/offers?org=${org.id}`}
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

      <OffersClient
        conferenceId={conference.id}
        conferenceYear={year}
        conferenceEdition={edition}
        organizationId={selectedOrg.id}
        organizationName={selectedOrg.name}
        initialOffers={offersResult.data}
        floorPlan={floorPlan}
        myCartOfferIds={myCartOfferIds}
      />
    </main>
  );
}
