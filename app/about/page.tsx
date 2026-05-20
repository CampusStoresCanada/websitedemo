import type { Metadata } from "next";
import { getStats, getSiteContent, getCSCStaff } from "@/lib/data";
import AboutHero from "@/components/about/AboutHero";
import MissionSection from "@/components/about/MissionSection";
import StatsSection from "@/components/home/StatsSection";
import BoardSection from "@/components/about/BoardSection";
import StaffSection from "@/components/about/StaffSection";
import MemberDirectoryTeaser from "@/components/about/MemberDirectoryTeaser";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "About | Campus Stores Canada",
  description:
    "Learn about Campus Stores Canada — the national association for post-secondary campus retail, connecting member institutions and vendor partners since 2004.",
};

export default async function AboutPage() {
  const [stats, boardMembers, staffContacts, heroContent, missionContent, whatWeDoItems] = await Promise.all([
    getStats(),
    getSiteContent("board_of_directors"),
    getCSCStaff(),
    getSiteContent("about_hero"),
    getSiteContent("about_mission"),
    getSiteContent("about_what_we_do"),
  ]);

  return (
    <div>
      <AboutHero content={heroContent[0] ?? null} />
      <MissionSection mission={missionContent[0] ?? null} whatWeDo={whatWeDoItems} />
      <StatsSection
        stats={{
          activeMembers: stats.memberCount,
          activePartners: stats.partnerCount,
          provincesRepresented: stats.provinceCount,
          totalFteServed: stats.totalFteServed,
          fteIsEstimate: stats.fteIsEstimate,
        }}
      />
      <BoardSection members={boardMembers} />
      <StaffSection staff={staffContacts} />
      <MemberDirectoryTeaser memberCount={stats.memberCount} />
    </div>
  );
}
