import LogoCarousel from "@/components/home/LogoCarousel";
import ValueProps from "@/components/home/ValueProps";

export default function Home() {
  return (
    <div>
      {/* Hero Section - Full Viewport Map */}
      <section className="relative h-[calc(100vh-64px)] min-h-[600px]">
        {/* Map Background Placeholder */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200">
          {/* Subtle grid pattern for visual interest */}
          <div
            className="absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />

          {/* Placeholder pins to suggest map */}
          <div className="absolute inset-0 overflow-hidden">
            {/* Sample pin positions across "Canada" */}
            <div className="absolute top-[30%] left-[15%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse" />
            <div className="absolute top-[35%] left-[25%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-300" />
            <div className="absolute top-[25%] left-[45%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-500" />
            <div className="absolute top-[40%] left-[55%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-700" />
            <div className="absolute top-[35%] left-[70%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-1000" />
            <div className="absolute top-[45%] left-[80%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-200" />
            <div className="absolute top-[50%] left-[85%] w-3 h-3 bg-[#D60001] rounded-full shadow-lg animate-pulse delay-400" />
          </div>
        </div>

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-white via-white/80 to-transparent" />

        {/* Hero Content */}
        <div className="relative h-full flex flex-col justify-end pb-16 md:pb-24">
          <div className="max-w-7xl mx-auto px-6 w-full">
            <div className="max-w-3xl">
              <h1 className="text-5xl md:text-7xl font-bold text-[#1A1A1A] tracking-tight leading-[1.1] mb-6">
                Canada&apos;s Campus
                <br />
                Store Network
              </h1>
              <p className="text-xl md:text-2xl text-[#6B6B6B] leading-relaxed mb-8 max-w-xl">
                Connecting campus stores coast-to-coast with resources, partnerships, and expertise.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button className="h-14 px-8 bg-[#D60001] hover:bg-[#B00001] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25">
                  Explore the Network
                </button>
                <button className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4]">
                  Learn More
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Floating Widget Preview - Shows during attract mode */}
        <div className="absolute top-1/3 right-[10%] hidden lg:block">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 transform rotate-2 hover:rotate-0 transition-transform">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-14 h-14 rounded-xl bg-[#D60001] flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-lg">UC</span>
              </div>
              <div>
                <h3 className="font-semibold text-[#1A1A1A]">University of Calgary</h3>
                <p className="text-sm text-[#6B6B6B]">Calgary, Alberta</p>
              </div>
            </div>
            <div className="flex gap-2 mb-4">
              <span className="px-3 py-1 bg-[#D60001]/10 text-[#D60001] text-xs font-medium rounded-full">
                Member
              </span>
              <span className="px-3 py-1 bg-slate-100 text-[#6B6B6B] text-xs font-medium rounded-full">
                Since 2018
              </span>
            </div>
            <p className="text-sm text-[#6B6B6B] mb-4">
              Serving 30,000+ students with course materials, merchandise, and technology.
            </p>
            <button className="text-sm font-medium text-[#D60001] hover:text-[#B00001] transition-colors">
              View Profile →
            </button>
          </div>
        </div>
      </section>

      {/* Logo Carousel - Members */}
      <LogoCarousel />

      {/* Value Props */}
      <ValueProps />

      {/* Stats Section */}
      <section className="py-24 md:py-32 bg-[#1A1A1A]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-8">
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-3">
                70
              </div>
              <div className="text-[#9B9B9B]">Member Institutions</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-3">
                100+
              </div>
              <div className="text-[#9B9B9B]">Vendor Partners</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-3">
                11
              </div>
              <div className="text-[#9B9B9B]">Provinces & Territories</div>
            </div>
            <div className="text-center">
              <div className="text-5xl md:text-6xl font-bold text-white mb-3">
                30+
              </div>
              <div className="text-[#9B9B9B]">Years of Service</div>
            </div>
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
            Connect with campus stores across Canada. Share resources, build partnerships, and grow together.
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
