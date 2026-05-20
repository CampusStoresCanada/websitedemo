import type { Metadata } from "next";
import MapHero from "@/components/map/MapHero";
import ValueProps from "@/components/home/ValueProps";
import DirectoryJoinCTA from "@/components/directory/DirectoryJoinCTA";
import FeaturedSponsors from "@/components/sponsorship/FeaturedSponsors";
import { getPartnersPageData } from "@/lib/homepage";
import { getSiteContent } from "@/lib/data";
import { getActiveSponsors } from "@/lib/actions/sponsorship";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Partners | Campus Stores Canada",
  description:
    "Explore CSC vendor partners — suppliers of course materials, general merchandise, and campus operations services.",
};

export default async function PartnersPage() {
  const [{ mapOrgs }, valuePropsHeader, valuePropsCards, sponsorsResult] = await Promise.all([
    getPartnersPageData(),
    getSiteContent("home_value_props_header"),
    getSiteContent("home_value_props"),
    getActiveSponsors(),
  ]);
const activeSponsors = sponsorsResult.success ? sponsorsResult.data : [];

  return (
    <div>
      <FeaturedSponsors sponsors={activeSponsors} />
      <MapHero
        organizations={mapOrgs}
        stories={[]}
        initialState={{ explore: true, viewMode: "table", lens: "partners", focus: "partners" }}
      />
      <ValueProps header={valuePropsHeader[0] ?? null} cards={valuePropsCards} />
      <DirectoryJoinCTA />
    </div>
  );
}
