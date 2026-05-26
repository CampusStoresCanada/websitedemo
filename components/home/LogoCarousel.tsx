import Link from "next/link";
import type { HomeMapOrg } from "@/lib/homepage";
import { TierIconPreview } from "@/components/sponsorship/SponsorTierBadge";
import OrgLogo from "@/components/ui/OrgLogo";

// Each card is w-36 (144px) + mx-6 each side (48px) = 192px
// Target scroll speed: 80px/s — comfortable, readable
const CARD_PX = 192;
const PX_PER_SEC = 50;

function carouselDuration(count: number): string {
  return `${Math.round((count * CARD_PX) / PX_PER_SEC)}s`;
}

export default function LogoCarousel({
  members,
  partners,
}: {
  members: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "logoUrl">>;
  partners: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "logoUrl" | "sponsorTier">>;
}) {

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
          <div
            className="flex w-max animate-scroll"
            style={{ animationDuration: carouselDuration(members.length) }}
          >
            {[...members, ...members].map((org, i) => (
              <div
                key={`${org.id}-${i}`}
                className="flex-shrink-0 mx-6 flex items-center justify-center"
              >
                <Link
                  href={`/org/${org.slug}`}
                  className="w-36 h-14 relative flex items-center justify-center bg-slate-50 rounded-lg px-3 hover:bg-slate-100 transition-colors"
                >
                  <OrgLogo
                    name={org.name}
                    logoUrl={org.logoUrl}
                    className="w-full h-10 rounded"
                  />
                </Link>
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
          <div
            className="flex w-max animate-scroll-reverse"
            style={{ animationDuration: carouselDuration(partners.length) }}
          >
            {[...partners, ...partners].map((org, i) => (
              <div
                key={`${org.id}-${i}`}
                className="flex-shrink-0 mx-6 flex items-center justify-center"
              >
                <Link
                  href={`/org/${org.slug}`}
                  className="w-36 h-14 relative flex items-center justify-center bg-slate-50 rounded-lg px-3 hover:bg-slate-100 transition-colors"
                >
                  <OrgLogo
                    name={org.name}
                    logoUrl={org.logoUrl}
                    className="w-full h-10 rounded"
                  />
                {org.sponsorTier && (
                  <span className="absolute -top-2 -right-2 drop-shadow-sm">
                    <TierIconPreview
                      icon={org.sponsorTier.icon ?? "shield"}
                      color={org.sponsorTier.color}
                      size={26}
                    />
                  </span>
                )}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
