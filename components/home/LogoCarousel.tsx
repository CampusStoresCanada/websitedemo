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

const LABEL_CLASS = "text-center text-sm font-medium text-[#9B9B9B] uppercase tracking-wider mb-8";
const HIGHLIGHT_LABEL_CLASS = "text-center text-xl font-bold text-[#1A1A1A] mb-8";

export default function LogoCarousel({
  members,
  partners,
  show = "both",
  highlight,
}: {
  members: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "logoUrl">>;
  partners: Array<Pick<HomeMapOrg, "id" | "slug" | "name" | "logoUrl" | "sponsorTier">>;
  /** Which strip(s) to render — pitch pages show only their own audience, the homepage shows both. */
  show?: "both" | "members" | "partners";
  /** Visually promote one strip's label over the other's — used when a pitch page shows both audiences but wants one to read as the lead story (e.g. partnership highlighting the member institutions a partner would reach). */
  highlight?: "members" | "partners";
}) {
  const showMembers = show === "both" || show === "members";
  const showPartners = show === "both" || show === "partners";

  return (
    <div className="py-16 md:py-24 bg-white border-y border-[#E5E5E5]">
      {/* Members */}
      {showMembers && (
      <div className={showPartners ? "mb-16" : ""}>
        <p className={highlight === "members" ? HIGHLIGHT_LABEL_CLASS : LABEL_CLASS}>
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
      )}

      {/* Partners */}
      {showPartners && (
      <div>
        <p className={highlight === "partners" ? HIGHLIGHT_LABEL_CLASS : LABEL_CLASS}>
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
      )}
    </div>
  );
}
