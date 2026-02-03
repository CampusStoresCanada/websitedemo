export default function ValueProps() {
  return (
    <section className="py-24 md:py-32 bg-[#FAFAFA]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="max-w-3xl mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6">
            More than a network.
            <br />
            <span className="text-[#6B6B6B]">A community.</span>
          </h2>
          <p className="text-xl text-[#6B6B6B] leading-relaxed">
            CSC transforms campus retail from a traditional business operation into a vital educational partner that enhances student success.
          </p>
        </div>

        {/* Value Props Grid */}
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          {/* Community of Practice */}
          <div className="group relative bg-white rounded-3xl p-8 md:p-10 border border-[#E5E5E5] hover:border-[#D60001]/20 hover:shadow-xl transition-all duration-300">
            <div className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-[#D60001]/10 flex items-center justify-center group-hover:bg-[#D60001] transition-colors">
              <svg
                className="w-6 h-6 text-[#D60001] group-hover:text-white transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div className="pr-16">
              <h3 className="text-2xl font-semibold text-[#1A1A1A] mb-4">
                Community of Practice
              </h3>
              <p className="text-[#6B6B6B] leading-relaxed mb-6">
                Connect with peers facing similar challenges. Facilitate knowledge sharing, problem solving, and build collective wisdom from shared experiences.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Direct peer connections
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Professional development
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Collaborative problem-solving
                </li>
              </ul>
            </div>
          </div>

          {/* Collective Voice */}
          <div className="group relative bg-white rounded-3xl p-8 md:p-10 border border-[#E5E5E5] hover:border-[#D60001]/20 hover:shadow-xl transition-all duration-300">
            <div className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-[#D60001]/10 flex items-center justify-center group-hover:bg-[#D60001] transition-colors">
              <svg
                className="w-6 h-6 text-[#D60001] group-hover:text-white transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                />
              </svg>
            </div>
            <div className="pr-16">
              <h3 className="text-2xl font-semibold text-[#1A1A1A] mb-4">
                Collective Voice
              </h3>
              <p className="text-[#6B6B6B] leading-relaxed mb-6">
                Advocate for independent stores with administrators. Provide data and frameworks to demonstrate value to institutions.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Unified industry responses
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Amplify member concerns
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Canadian representation
                </li>
              </ul>
            </div>
          </div>

          {/* Resource Hub */}
          <div className="group relative bg-white rounded-3xl p-8 md:p-10 border border-[#E5E5E5] hover:border-[#D60001]/20 hover:shadow-xl transition-all duration-300">
            <div className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-[#D60001]/10 flex items-center justify-center group-hover:bg-[#D60001] transition-colors">
              <svg
                className="w-6 h-6 text-[#D60001] group-hover:text-white transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <div className="pr-16">
              <h3 className="text-2xl font-semibold text-[#1A1A1A] mb-4">
                Resource Hub
              </h3>
              <p className="text-[#6B6B6B] leading-relaxed mb-6">
                Access best practices, benchmarking data, tools, templates, and curated vendor relationships all in one place.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Benchmarking data & analysis
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Tools and templates
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Educational content & training
                </li>
              </ul>
            </div>
          </div>

          {/* Innovation Catalyst */}
          <div className="group relative bg-white rounded-3xl p-8 md:p-10 border border-[#E5E5E5] hover:border-[#D60001]/20 hover:shadow-xl transition-all duration-300">
            <div className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-[#D60001]/10 flex items-center justify-center group-hover:bg-[#D60001] transition-colors">
              <svg
                className="w-6 h-6 text-[#D60001] group-hover:text-white transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div className="pr-16">
              <h3 className="text-2xl font-semibold text-[#1A1A1A] mb-4">
                Innovation Catalyst
              </h3>
              <p className="text-[#6B6B6B] leading-relaxed mb-6">
                Identify emerging trends and opportunities. Test new approaches collectively and share successful experiments.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Trend identification
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Reduced innovation risk
                </li>
                <li className="flex items-center gap-3 text-sm text-[#6B6B6B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D60001]" />
                  Strategic evolution support
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
