import type { ReactNode } from "react";
import { formatDateRange } from "@/lib/utils";

/**
 * The conference's dates/venue/name banner — shared across every page that
 * talks about this conference (the hub, /attend, eventually /exhibit) so
 * logistics (when, where) live in one place instead of being retyped per
 * page. The right-hand slot is deliberately generic content, not a fixed
 * "bursary" concept — the hub page puts the bursary thermometer there, the
 * non-member /attend page puts a Join CSC eligibility CTA there. Same shell,
 * different ask, decided by the caller rather than baked into this block.
 */
export default function ConferenceHero({
  name,
  startDate,
  endDate,
  venue,
  copy,
  sideContent,
  ctaContent,
}: {
  name: string;
  startDate: string | null;
  endDate: string | null;
  venue: string;
  copy: string;
  sideContent?: ReactNode;
  /** Optional major call-to-action rendered under the copy paragraph — e.g. the Member view's "Register your interest" bursary CTA. */
  ctaContent?: ReactNode;
}) {
  return (
    <section className="bg-gradient-to-br from-[#163D6D] to-[#0d2547] py-16 md:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-sm">
              {startDate && endDate ? formatDateRange(startDate, endDate) : "Dates coming soon"}
              {venue ? ` · ${venue}` : ""}
            </span>
            <h1 className="mt-5 text-4xl md:text-6xl font-bold text-white tracking-tight">{name}</h1>
            <p className="mt-5 text-lg md:text-xl text-white/80 leading-relaxed">{copy}</p>
            {ctaContent}
          </div>

          {sideContent && (
            <div className="lg:shrink-0 lg:border-l lg:border-white/15 lg:pl-10">{sideContent}</div>
          )}
        </div>
      </div>
    </section>
  );
}
