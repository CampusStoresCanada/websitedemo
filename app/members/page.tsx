import type { Metadata } from "next";
import MapHero from "@/components/map/MapHero";
import ValueProps from "@/components/home/ValueProps";
import DirectoryJoinCTA from "@/components/directory/DirectoryJoinCTA";
import { getMembersPageData } from "@/lib/homepage";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Members | Campus Stores Canada",
  description:
    "Explore campus store member institutions across Canada — map, table, and detailed profiles.",
};

export default async function MembersPage() {
  const { mapOrgs } = await getMembersPageData();

  return (
    <div>
      <MapHero
        organizations={mapOrgs}
        stories={[]}
        initialState={{ explore: true, viewMode: "table", lens: null, focus: "members" }}
      />
      <ValueProps />
      <DirectoryJoinCTA />
    </div>
  );
}
