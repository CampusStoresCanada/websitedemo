import type { Metadata } from "next";
import { getStats, getSiteContent } from "@/lib/data";
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
  const [stats, boardMembers, staffMembers] = await Promise.all([
    getStats(),
    getSiteContent("board_of_directors"),
    getSiteContent("staff"),
  ]);

  return (
    <div>
      <AboutHero />
      <MissionSection />
      <StatsSection
        stats={{
          activeMembers: stats.memberCount,
          activePartners: stats.partnerCount,
          provincesRepresented: stats.provinceCount,
          totalFteServed: 0,
        }}
      />
      <BoardSection members={boardMembers} />
      <StaffSection staff={staffMembers} />
      <MemberDirectoryTeaser memberCount={stats.memberCount} />
    </div>
  );
}
