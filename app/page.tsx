import LogoCarousel from "@/components/home/LogoCarousel";
import ValueProps from "@/components/home/ValueProps";
import StatsSection from "@/components/home/StatsSection";
import MapHero from "@/components/map/MapHero";
import { getOrganizations } from "@/lib/data";

export default async function Home() {
  // Fetch all organizations for the map
  const organizations = await getOrganizations();

  return (
    <div>
      {/* Hero Section with Map */}
      <MapHero organizations={organizations} />

      {/* Logo Carousel - Members */}
      <LogoCarousel />

      {/* Value Props */}
      <ValueProps />

      {/* Stats Section */}
      <StatsSection />

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
            <button className="h-14 px-8 bg-[#D60001] hover:bg-[#B00001] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25">
              Become a Member
            </button>
            <button className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4]">
              Partner With Us
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
