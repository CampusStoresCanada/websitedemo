import LogoCarousel from "@/components/home/LogoCarousel";
import ValueProps from "@/components/home/ValueProps";
import StatsSection from "@/components/home/StatsSection";
import CommunityVoices from "@/components/home/CommunityVoices";
import HomeContent from "@/components/home/HomeContent";
import MapHero from "@/components/map/MapHero";
import SponsorStrip from "@/components/sponsorship/SponsorStrip";
import Link from "next/link";
import { getHomePageData } from "@/lib/homepage";
import { getHomeSlides } from "@/lib/homepage-slides";
import { getSiteContent } from "@/lib/data";
import { fieldProps } from "@/lib/editable-fields";
import { getActiveSponsors } from "@/lib/actions/sponsorship";
import { getViewerContext } from "@/lib/visibility/viewer";

// Revalidate every 60 seconds to pick up data changes
export const revalidate = 60;

export default async function Home() {
  // Resolved first (not in the Promise.all below) since getHomePageData needs
  // it to decide whether a draft conference's pin is visible — same
  // draft-preview convention already used on the conference offers/cart pages.
  const viewer = await getViewerContext();
  const viewerIsAdmin = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";

  const [data, slides, valuePropsHeader, valuePropsCards, communityVoices, homeCta, sponsorsResult] = await Promise.all([
    getHomePageData(viewerIsAdmin),
    getHomeSlides(viewer),
    getSiteContent("home_value_props_header"),
    getSiteContent("home_value_props"),
    getSiteContent("home_community_voices"),
    getSiteContent("home_cta"),
    getActiveSponsors(),
  ]);
  const activeSponsors = sponsorsResult.success ? sponsorsResult.data : [];

  const ctaContent = homeCta[0] ?? null;

  return (
    <div>
      {/* Hero Section with Map — takes over viewport on hover explore */}
      <MapHero organizations={data.mapOrgs} stories={data.stories} conferencePin={slides.conferencePin} slides={slides} />

      {/* Everything below fades out when map enters explore mode */}
      <HomeContent>
        {/* Logo Carousel - Members */}
        <LogoCarousel members={data.memberOrgs} partners={data.partnerOrgs} />

        {/* Sponsor strip — hidden when no active sponsors */}
        <SponsorStrip sponsors={activeSponsors} />

        {/* Value Props */}
        <ValueProps
          header={valuePropsHeader[0] ?? null}
          cards={valuePropsCards}
        />

        {/* Stats Section */}
        <StatsSection stats={data.stats} />

        {/* Community Voices */}
        <CommunityVoices slots={communityVoices} />

        {/* CTA Section */}
        <section className="py-24 md:py-32">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <h2
              className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6"
              {...(ctaContent ? fieldProps("site_content", "title", ctaContent.id) : {})}
            >
              {ctaContent?.title ?? "Ready to join the network?"}
            </h2>
            <p
              className="text-xl text-[#6B6B6B] max-w-2xl mx-auto mb-10"
              {...(ctaContent ? fieldProps("site_content", "body", ctaContent.id) : {})}
            >
              {ctaContent?.body ?? "Connect with campus stores across Canada. Share resources, build partnerships, and grow together."}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/membership" className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center">
                Become a Member
              </Link>
              <Link href="/partnership" className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center">
                Partner With Us
              </Link>
            </div>
          </div>
        </section>
      </HomeContent>
    </div>
  );
}
