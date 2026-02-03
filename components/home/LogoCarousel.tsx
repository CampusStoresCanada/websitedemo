"use client";

// Placeholder logos - will replace with real ones
const memberLogos = [
  { name: "University of Calgary", abbr: "UC" },
  { name: "University of British Columbia", abbr: "UBC" },
  { name: "McGill University", abbr: "McG" },
  { name: "York University", abbr: "YU" },
  { name: "NAIT", abbr: "NAIT" },
  { name: "Fanshawe College", abbr: "FC" },
  { name: "Dalhousie University", abbr: "Dal" },
  { name: "University of Saskatchewan", abbr: "USk" },
  { name: "Memorial University", abbr: "MUN" },
  { name: "Sheridan College", abbr: "SC" },
];

const partnerLogos = [
  { name: "VitalSource", abbr: "VS" },
  { name: "Cengage", abbr: "Cen" },
  { name: "Follett", abbr: "Fol" },
  { name: "RedShelf", abbr: "RS" },
  { name: "McGraw Hill", abbr: "MH" },
];

export default function LogoCarousel() {
  return (
    <div className="py-16 md:py-24 bg-white border-y border-[#E5E5E5]">
      {/* Members */}
      <div className="mb-16">
        <p className="text-center text-sm font-medium text-[#9B9B9B] uppercase tracking-wider mb-8">
          Trusted by Canada&apos;s leading institutions
        </p>
        <div className="relative overflow-hidden">
          {/* Gradient masks */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />

          {/* Scrolling container */}
          <div className="flex animate-scroll">
            {[...memberLogos, ...memberLogos].map((logo, i) => (
              <div
                key={i}
                className="flex-shrink-0 mx-8 flex items-center justify-center"
              >
                <div className="w-32 h-12 bg-slate-100 rounded-lg flex items-center justify-center px-4 hover:bg-slate-200 transition-colors">
                  <span className="text-[#6B6B6B] font-medium text-sm truncate">
                    {logo.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Partners */}
      <div>
        <p className="text-center text-sm font-medium text-[#9B9B9B] uppercase tracking-wider mb-8">
          Powered by industry-leading partners
        </p>
        <div className="relative overflow-hidden">
          {/* Gradient masks */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />

          {/* Scrolling container - reverse direction */}
          <div className="flex animate-scroll-reverse">
            {[...partnerLogos, ...partnerLogos, ...partnerLogos].map((logo, i) => (
              <div
                key={i}
                className="flex-shrink-0 mx-8 flex items-center justify-center"
              >
                <div className="w-32 h-12 bg-slate-100 rounded-lg flex items-center justify-center px-4 hover:bg-slate-200 transition-colors">
                  <span className="text-[#6B6B6B] font-medium text-sm truncate">
                    {logo.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
