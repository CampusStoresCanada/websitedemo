import Link from "next/link";
import type { ActiveSponsor } from "@/lib/sponsorship/types";

interface FeaturedSponsorsProps {
  sponsors: ActiveSponsor[];
}

/**
 * Slim inline sponsor strip for the Partners directory page.
 * Sits flush at the top, out of the way of the directory tool.
 */
export default function FeaturedSponsors({ sponsors }: FeaturedSponsorsProps) {
  if (sponsors.length === 0) return null;

  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-4 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 shrink-0">
          Presenting Sponsor{sponsors.length > 1 ? "s" : ""}
        </span>
        <div
          className="h-4 w-0.5 rounded-full shrink-0"
          style={{ backgroundColor: sponsors[0]?.tier.color ?? "#ccc" }}
        />
        <div className="flex items-center gap-5 flex-wrap">
          {sponsors.map((sponsor) => (
            <Link
              key={sponsor.agreementId}
              href={`/org/${sponsor.organizationSlug}`}
              className="flex items-center gap-2.5 group"
            >
              {sponsor.organizationLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sponsor.organizationLogoUrl}
                  alt=""
                  className="h-5 w-auto object-contain"
                />
              )}
              <span className="text-sm font-semibold text-gray-700 group-hover:text-[#EE2A2E] transition-colors">
                {sponsor.organizationName}
              </span>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  color: sponsor.tier.color ?? "#888",
                  backgroundColor: `${sponsor.tier.color ?? "#888"}18`,
                }}
              >
                {sponsor.tier.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
