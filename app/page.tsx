import LogoCarousel from "@/components/home/LogoCarousel";
import ValueProps from "@/components/home/ValueProps";
import StatsSection from "@/components/home/StatsSection";
import HomeContent from "@/components/home/HomeContent";
import MapHero from "@/components/map/MapHero";
import Link from "next/link";
import { getHomePageData } from "@/lib/homepage";

// Revalidate every 60 seconds to pick up data changes
export const revalidate = 60;

export default async function Home() {
  const data = await getHomePageData();
  const members = data.memberOrgs.slice(0, 12);
  const partners = data.partnerOrgs.slice(0, 12);

  return (
    <div>
      {/* Hero Section with Map — takes over viewport on hover explore */}
      <MapHero organizations={data.mapOrgs} stories={data.stories} />

      {/* Everything below fades out when map enters explore mode */}
      <HomeContent>
        {/* Logo Carousel - Members */}
        <LogoCarousel members={data.memberOrgs} partners={data.partnerOrgs} />

        {/* Value Props */}
        <ValueProps />

        {/* Stats Section */}
        <StatsSection stats={data.stats} />

        <section className="py-16 md:py-20 bg-white border-t border-[#E5E5E5]">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A]">Canadian Institutions</h2>
                <p className="text-[#6B6B6B] mt-2">
                  {data.stats.activeMembers} active member institutions.
                </p>
              </div>
              <Link href="/members" className="text-sm font-medium text-[#EE2A2E] hover:text-[#D92327]">
                View all members →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((org) => (
                <Link
                  key={org.id}
                  href={`/org/${org.slug}`}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 hover:border-gray-300 hover:bg-white transition-colors"
                >
                  <p className="font-medium text-gray-900">{org.name}</p>
                  <p className="text-sm text-gray-600">
                    {[org.province, org.organizationType].filter(Boolean).join(" • ")}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 md:py-20 bg-[#fafafa] border-y border-[#E5E5E5]">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A]">Industry Partners</h2>
                <p className="text-[#6B6B6B] mt-2">
                  {data.stats.activePartners} active partner organizations.
                </p>
              </div>
              <Link href="/partners" className="text-sm font-medium text-[#EE2A2E] hover:text-[#D92327]">
                View all partners →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {partners.map((org) => (
                <Link
                  key={org.id}
                  href={`/org/${org.slug}`}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-gray-300 transition-colors"
                >
                  <p className="font-medium text-gray-900">{org.name}</p>
                  <p className="text-sm text-gray-600">
                    {[org.primaryCategory, org.province].filter(Boolean).join(" • ")}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 md:py-32">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6">
              Ready to join the network?
            </h2>
            <p className="text-xl text-[#6B6B6B] max-w-2xl mx-auto mb-10">
              Connect with campus stores across Canada. Share resources, build
              partnerships, and grow together.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/apply/member" className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center">
                Become a Member
              </Link>
              <Link href="/apply/partner" className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center">
                Partner With Us
              </Link>
            </div>
          </div>
        </section>
      </HomeContent>
    </div>
  );
}
