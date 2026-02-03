export default function Home() {
  return (
    <div className="bg-[#FAFAFA]">
      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-semibold text-[#1A1A1A] tracking-tight mb-6">
            Canada&apos;s Campus Store Network
          </h1>
          <p className="text-lg md:text-xl text-[#6B6B6B] max-w-2xl mx-auto mb-8">
            Connecting 70 campus stores coast-to-coast with resources,
            partnerships, and expertise.
          </p>
          <a
            href="#map"
            className="inline-flex h-12 px-8 bg-[#D60001] hover:bg-[#B00001] text-white font-medium rounded-md items-center transition-colors"
          >
            Explore the Network
          </a>
        </div>
      </section>

      {/* Map Section Placeholder */}
      <section id="map" className="py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-white rounded-xl border border-[#E5E5E5] shadow-sm overflow-hidden">
            {/* Map will go here */}
            <div className="h-[400px] md:h-[600px] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#D60001]/10 flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-[#D60001]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <p className="text-[#6B6B6B] font-medium">
                  Interactive Map Coming Soon
                </p>
                <p className="text-sm text-[#9B9B9B] mt-1">
                  Mapbox integration on Day 3
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-[#D60001] mb-2">
                70
              </div>
              <div className="text-sm text-[#6B6B6B]">Member Institutions</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-[#D60001] mb-2">
                100+
              </div>
              <div className="text-sm text-[#6B6B6B]">Vendor Partners</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-[#D60001] mb-2">
                11
              </div>
              <div className="text-sm text-[#6B6B6B]">
                Provinces & Territories
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-[#D60001] mb-2">
                30+
              </div>
              <div className="text-sm text-[#6B6B6B]">Years of Service</div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Prop Section */}
      <section className="py-16 md:py-24 bg-white border-t border-[#E5E5E5]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-semibold text-[#1A1A1A] mb-4">
              Why Campus Stores Canada?
            </h2>
            <p className="text-[#6B6B6B] max-w-2xl mx-auto">
              We transform campus retail from a traditional business operation
              into a vital educational partner that enhances student success.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Community of Practice */}
            <div className="p-6 rounded-lg border border-[#E5E5E5] hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-md bg-[#D60001]/10 flex items-center justify-center mb-4">
                <svg
                  className="w-5 h-5 text-[#D60001]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2">
                Community of Practice
              </h3>
              <p className="text-sm text-[#6B6B6B]">
                Connect with peers facing similar challenges. Share knowledge
                and build collective wisdom.
              </p>
            </div>

            {/* Collective Voice */}
            <div className="p-6 rounded-lg border border-[#E5E5E5] hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-md bg-[#D60001]/10 flex items-center justify-center mb-4">
                <svg
                  className="w-5 h-5 text-[#D60001]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2">
                Collective Voice
              </h3>
              <p className="text-sm text-[#6B6B6B]">
                Advocate for independent stores. Create unified responses to
                industry challenges.
              </p>
            </div>

            {/* Resource Hub */}
            <div className="p-6 rounded-lg border border-[#E5E5E5] hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-md bg-[#D60001]/10 flex items-center justify-center mb-4">
                <svg
                  className="w-5 h-5 text-[#D60001]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2">Resource Hub</h3>
              <p className="text-sm text-[#6B6B6B]">
                Access best practices, benchmarking data, tools, and curated
                vendor relationships.
              </p>
            </div>

            {/* Innovation Catalyst */}
            <div className="p-6 rounded-lg border border-[#E5E5E5] hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-md bg-[#D60001]/10 flex items-center justify-center mb-4">
                <svg
                  className="w-5 h-5 text-[#D60001]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2">
                Innovation Catalyst
              </h3>
              <p className="text-sm text-[#6B6B6B]">
                Identify emerging trends. Test new approaches collectively with
                reduced risk.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
