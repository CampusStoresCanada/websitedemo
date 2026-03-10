export default function MissionSection() {
  return (
    <section className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          {/* Mission */}
          <div>
            <h2 className="text-sm uppercase tracking-wider text-[#D60001] font-semibold mb-4">
              Our Mission
            </h2>
            <p className="text-lg text-[#4A4A4A] leading-relaxed">
              Campus Stores Canada (CSC) advocates for and supports campus
              retail operations at post-secondary institutions across the
              country. We provide a forum for collaboration, professional
              development, benchmarking, and shared purchasing power — ensuring
              campus stores can deliver exceptional service to students, faculty,
              and staff.
            </p>
          </div>

          {/* Values */}
          <div>
            <h2 className="text-sm uppercase tracking-wider text-[#D60001] font-semibold mb-4">
              What We Do
            </h2>
            <ul className="space-y-4 text-lg text-[#4A4A4A]">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D60001] flex-shrink-0" />
                <span>
                  Benchmarking surveys and data sharing to help stores make
                  data-driven decisions
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D60001] flex-shrink-0" />
                <span>
                  Annual conferences, regional meetups, and peer-learning
                  opportunities
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D60001] flex-shrink-0" />
                <span>
                  Vendor partner program connecting stores with trusted
                  suppliers
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#D60001] flex-shrink-0" />
                <span>
                  Advocacy for institutional independence and campus retail
                  sustainability
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
