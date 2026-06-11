import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getConferenceBooths,
  getBoothSaleContext,
} from "@/lib/actions/conference-booths";
import { getBoothPackagesFromProducts } from "@/lib/constants/floor-plan";
import FloorPlanClient from "./floor-plan-client";

export const metadata = { title: "Booth Selection" };

interface OrgRow {
  id: string;
  name: string;
  type: string | null;
}

export default async function BoothsPage({
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
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const db = createAdminClient();

  // Get orgs the user belongs to
  const { data: userOrgs } = await db
    .from("user_organizations")
    .select("organization_id, organizations(id, name, type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const orgs: OrgRow[] = (userOrgs ?? []).map(
    (row) => (row as unknown as { organizations: OrgRow }).organizations
  );

  const vendorOrgs = orgs.filter((o) => {
    const t = (o.type ?? "").toLowerCase();
    return t === "vendor_partner" || t === "vendor partner";
  });

  const selectedOrg =
    vendorOrgs.find((o) => o.id === query.org) ?? vendorOrgs[0] ?? null;

  // Fetch booths (always visible — floor plan is public)
  const boothsResult = await getConferenceBooths(conference.id);

  // Booth packages + partnership add-on — admin-editable via conference_products
  const boothPackages = getBoothPackagesFromProducts(conference.conference_products);
  const partnershipCents =
    conference.conference_products.find((p) => p.slug === "annual_partnership_bundle")
      ?.price_cents ?? 0;

  // Get sale window context for the selected org
  const saleCtx = selectedOrg
    ? await getBoothSaleContext(conference.id, selectedOrg.id)
    : null;

  const saleContext = saleCtx?.data ?? {
    sponsorOpenAt: null,
    generalOpenAt: null,
    isSponsorWindow: false,
    isGeneralOpen: false,
    isOrgSponsor: false,
    canSelect: false,
  };

  function formatDate(ts: string | null): string {
    if (!ts) return "TBD";
    const d = new Date(
      ts.endsWith("Z") || ts.includes("+") ? ts : ts.replace(" ", "T") + "Z"
    );
    return d.toLocaleDateString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/Toronto",
    });
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-1 text-sm text-gray-600">Exhibitor Booth Selection</p>
      </div>

      {/* Org selector (vendor partners only) */}
      {vendorOrgs.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Booth selection is available to Vendor Partner organizations. Your account does not
          have an active vendor partnership.
        </div>
      )}

      {vendorOrgs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {vendorOrgs.map((org) => (
            <a
              key={org.id}
              href={`/conference/${year}/${edition}/booths?org=${org.id}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                org.id === selectedOrg?.id
                  ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {org.name}
            </a>
          ))}
        </div>
      )}

      {/* Sale window status banner */}
      {selectedOrg && (
        <SaleWindowBanner
          saleContext={saleContext}
          sponsorDate={formatDate(saleContext.sponsorOpenAt)}
          generalDate={formatDate(saleContext.generalOpenAt)}
        />
      )}

      {/* Pricing info */}
      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        {boothPackages.map((pkg) => {
          const total = pkg.price_cents + partnershipCents;
          return (
            <div key={pkg.id} className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="font-semibold text-blue-900">{pkg.name}</div>
              <div className="mt-1 text-2xl font-bold text-blue-700">
                ${(total / 100).toLocaleString("en-CA", { minimumFractionDigits: 0 })}
              </div>
              <div className="mt-1 text-xs text-blue-600">
                ${(partnershipCents / 100).toLocaleString("en-CA")} partnership + $
                {(pkg.price_cents / 100).toLocaleString("en-CA")} booth
                {pkg.description ? ` · ${pkg.description}` : ""}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Partnership fee waived if your organization already holds a 2026–27 CSC partnership.
        All prices in CAD + applicable taxes.
      </p>

      {/* Floor plan */}
      {boothsResult.success && boothsResult.data ? (
        <FloorPlanClient
          booths={boothsResult.data}
          boothPackages={boothPackages}
          canSelect={saleContext.canSelect}
          year={year}
          edition={edition}
          selectedOrgId={selectedOrg?.id ?? null}
          floorPlanUrl={conference.floor_plan_url}
        />
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to load floor plan: {boothsResult.error}
        </div>
      )}
    </main>
  );
}

function SaleWindowBanner({
  saleContext,
  sponsorDate,
  generalDate,
}: {
  saleContext: {
    isSponsorWindow: boolean;
    isGeneralOpen: boolean;
    isOrgSponsor: boolean;
    canSelect: boolean;
  };
  sponsorDate: string;
  generalDate: string;
}) {
  if (saleContext.isGeneralOpen) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Booth selection is <strong>open</strong>. Select a highlighted booth on the floor plan to continue.
      </div>
    );
  }

  if (saleContext.isSponsorWindow && saleContext.isOrgSponsor) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Sponsor priority window.</strong> As a conference sponsor, your organization has
        early booth access until {generalDate}.
      </div>
    );
  }

  if (saleContext.isSponsorWindow && !saleContext.isOrgSponsor) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Sponsor priority window active.</strong> General booth selection opens{" "}
        {generalDate}. Only confirmed conference sponsors may select booths until then.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      Booth sales open to sponsors on <strong>{sponsorDate}</strong>, and to all vendors on{" "}
      <strong>{generalDate}</strong>. The floor plan below is shown for reference — booth
      selection will be enabled when the sale opens.
    </div>
  );
}
