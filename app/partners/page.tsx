import type { Metadata } from "next";
import MapHero from "@/components/map/MapHero";
import ValueProps from "@/components/home/ValueProps";
import DirectoryJoinCTA from "@/components/directory/DirectoryJoinCTA";
import { getPartnersPageData } from "@/lib/homepage";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Partners | Campus Stores Canada",
  description:
    "Explore CSC vendor partners — suppliers of course materials, general merchandise, and campus operations services.",
};

export default async function PartnersPage() {
  const { mapOrgs } = await getPartnersPageData();

  return (
    <div>
      <MapHero
        organizations={mapOrgs}
        stories={[]}
        initialState={{ explore: true, viewMode: "table", lens: "partners" }}
      />
      <ValueProps />
      <DirectoryJoinCTA />
    </div>
  );
}
