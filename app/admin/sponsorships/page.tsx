import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guards";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import TiersPanel from "@/components/admin/sponsorships/TiersPanel";
import AgreementsPanel from "@/components/admin/sponsorships/AgreementsPanel";
import SlotsPanel from "@/components/admin/sponsorships/SlotsPanel";
import {
  listSponsorTiers,
  listSponsorAgreements,
  listPlacementSlots,
  listOrgsForSelect,
  listBenefitReferenceOptions,
} from "@/lib/actions/sponsorship";

export const metadata: Metadata = {
  title: "Sponsorships | Admin | Campus Stores Canada",
};

const TABS = [
  { key: "agreements", label: "Agreements" },
  { key: "tiers",      label: "Tiers" },
  { key: "slots",      label: "Placement Slots" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function AdminSponsorshipsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) return <div className="p-8 text-gray-500">Access denied.</div>;

  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === rawTab)?.key) ?? "agreements";

  // Fetch all three datasets in parallel — each is small and fast
  const [tiersResult, agreementsResult, slotsResult, orgsResult, refOptionsResult] = await Promise.all([
    listSponsorTiers(true),          // include inactive for admin view
    listSponsorAgreements(),
    listPlacementSlots(true),        // include inactive for admin view
    listOrgsForSelect(),
    listBenefitReferenceOptions(),
  ]);

  if (!tiersResult.success)     return <div className="p-8 text-red-600">Failed to load tiers: {tiersResult.error}</div>;
  if (!agreementsResult.success) return <div className="p-8 text-red-600">Failed to load agreements: {agreementsResult.error}</div>;
  if (!slotsResult.success)     return <div className="p-8 text-red-600">Failed to load slots: {slotsResult.error}</div>;
  if (!orgsResult.success)      return <div className="p-8 text-red-600">Failed to load organizations: {orgsResult.error}</div>;

  const activeSponsorCount = agreementsResult.data.filter((a) => a.status === "active").length;

  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Sponsorships"
        description={
          activeSponsorCount > 0
            ? `${activeSponsorCount} active sponsor${activeSponsorCount !== 1 ? "s" : ""}`
            : "Manage sponsor tiers, agreements, and placements"
        }
      />

      {/* Tab nav */}
      <div className="flex gap-0 border-b border-gray-200 mb-6">
        {TABS.map(({ key, label }) => {
          const isActive = tab === key;
          return (
            <a
              key={key}
              href={`/admin/sponsorships?tab=${key}`}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </a>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "agreements" && (
        <AgreementsPanel
          agreements={agreementsResult.data}
          tiers={tiersResult.data}
          orgs={orgsResult.data}
        />
      )}
      {tab === "tiers" && (
        <TiersPanel
        tiers={tiersResult.data}
        referenceOptions={refOptionsResult.success ? refOptionsResult.data : { conferenceInstances: [], offsiteEvents: [], programItems: [] }}
      />
      )}
      {tab === "slots" && (
        <SlotsPanel slots={slotsResult.data} />
      )}
    </div>
  );
}
