import { getMembers, getPartners } from "@/lib/data";
import Image from "next/image";

export default async function LogoCarousel() {
  const [members, partners] = await Promise.all([getMembers(), getPartners()]);

  return (
    <div className="py-16 md:py-24 bg-white border-y border-[#E5E5E5]">
      {/* Members */}
      <div className="mb-16">
        <p className="text-center text-sm font-medium text-[#9B9B9B] uppercase tracking-wider mb-8">
          Trusted by {members.length} Canadian institutions
        </p>
        <div className="relative overflow-hidden">
          {/* Gradient masks */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />

          {/* Scrolling container */}
          <div className="flex animate-scroll">
            {[...members, ...members].map((org, i) => (
              <div
                key={`${org.id}-${i}`}
                className="flex-shrink-0 mx-6 flex items-center justify-center"
              >
                {org.logo_url ? (
                  <div className="w-36 h-14 relative flex items-center justify-center bg-slate-50 rounded-lg px-3 hover:bg-slate-100 transition-colors">
                    <Image
                      src={org.logo_url}
                      alt={org.name || ""}
                      width={120}
                      height={40}
                      className="object-contain max-h-10"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="w-36 h-14 bg-slate-100 rounded-lg flex items-center justify-center px-3 hover:bg-slate-200 transition-colors">
                    <span className="text-[#6B6B6B] font-medium text-xs text-center truncate">
                      {org.name}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Partners */}
      <div>
        <p className="text-center text-sm font-medium text-[#9B9B9B] uppercase tracking-wider mb-8">
          Powered by {partners.length}+ industry partners
        </p>
        <div className="relative overflow-hidden">
          {/* Gradient masks */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />

          {/* Scrolling container - reverse direction */}
          <div className="flex animate-scroll-reverse">
            {[...partners, ...partners].map((org, i) => (
              <div
                key={`${org.id}-${i}`}
                className="flex-shrink-0 mx-6 flex items-center justify-center"
              >
                {org.logo_url ? (
                  <div className="w-36 h-14 relative flex items-center justify-center bg-slate-50 rounded-lg px-3 hover:bg-slate-100 transition-colors">
                    <Image
                      src={org.logo_url}
                      alt={org.name || ""}
                      width={120}
                      height={40}
                      className="object-contain max-h-10"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="w-36 h-14 bg-slate-100 rounded-lg flex items-center justify-center px-3 hover:bg-slate-200 transition-colors">
                    <span className="text-[#6B6B6B] font-medium text-xs text-center truncate">
                      {org.name}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
