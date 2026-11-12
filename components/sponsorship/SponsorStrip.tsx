import Link from "next/link";
import type { SponsorInSlot } from "@/lib/sponsorship/types";

interface SponsorStripProps {
  /** Only sponsors with a placement in the homepage_featured slot (sponsorsInSlot). */
  sponsors: SponsorInSlot[];
}

/**
 * Slim "Supported by" strip for the homepage.
 * Shown below the Community Voices section.
 * Hidden entirely when there are no active sponsors.
 */
export default function SponsorStrip({ sponsors }: SponsorStripProps) {
  if (sponsors.length === 0) return null;

  return (
    <section className="border-t border-gray-100 py-10">
      <div className="max-w-7xl mx-auto px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center mb-8">
          Supported by
        </p>
        <div className="flex flex-wrap items-center justify-center gap-10">
          {sponsors.map((sponsor) => (
            <Link
              key={sponsor.agreementId}
              href={`/org/${sponsor.organizationSlug}`}
              className="group transition-opacity hover:opacity-70"
            >
              {sponsor.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sponsor.logoUrl}
                  alt={sponsor.organizationName}
                  className="h-10 w-auto object-contain max-w-[160px]"
                />
              ) : (
                <span className="text-sm font-semibold text-gray-500 group-hover:text-gray-700 transition-colors">
                  {sponsor.organizationName}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
