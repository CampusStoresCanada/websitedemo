import type { Metadata } from "next";
import Link from "next/link";
import SponsorshipLadder from "@/components/conference/SponsorshipLadder";
import LogoCarousel from "@/components/home/LogoCarousel";
import PartnershipPricingCard from "@/components/partnership/PartnershipPricingCard";
import RenewalTerms from "@/components/pricing/RenewalTerms";
import { getPartnersPageData, getMembersPageData } from "@/lib/homepage";
import { getActiveConferenceInstance } from "@/lib/actions/conference-availability";
import { getBillingConfig, getRenewalConfig } from "@/lib/policy/engine";
import { effectiveProrationDiscountPct } from "@/lib/policy/proration";

export const metadata: Metadata = {
  title: "Partnership | Campus Stores Canada",
  description:
    "Partner with Campus Stores Canada — reach member institutions across the country through partnership tiers built for vendors.",
};

export default async function PartnershipPage() {
  const [{ mapOrgs: partnerOrgs }, { mapOrgs: memberOrgs }, activeConference, billing, renewal] =
    await Promise.all([
      getPartnersPageData(),
      getMembersPageData(),
      getActiveConferenceInstance(),
      getBillingConfig(),
      getRenewalConfig(),
    ]);

  const discountPct = effectiveProrationDiscountPct(
    billing.proration_rules,
    renewal.cycle_start_month_day,
    renewal.pre_renewal_skip_stub_days
  );

  return (
    <div>
      <section className="py-20 md:py-28 bg-[#FAFAFA]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-4xl md:text-6xl font-bold text-[#1A1A1A] tracking-tight">
                Reach campus stores across Canada.
              </h1>
              <p className="mt-6 text-xl text-[#6B6B6B] leading-relaxed">
                CSC partnership puts your team in front of member institutions nationwide — a
                direct contact list, a self-managed listing in the partner directory, and a seat
                in the Circle community where members are already looking for what you sell.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/apply/partner"
                  className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
                >
                  Apply for Partnership
                </Link>
                <Link
                  href="/partners"
                  className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center"
                >
                  Browse partners
                </Link>
              </div>
            </div>

            <div className="w-full max-w-md lg:shrink-0">
              <PartnershipPricingCard
                vendorRate={billing.partnership_rate}
                discountPct={discountPct}
              />
              <RenewalTerms cycleStartMonthDay={renewal.cycle_start_month_day} />
            </div>
          </div>
        </div>
      </section>

      <LogoCarousel members={memberOrgs} partners={partnerOrgs} show="both" highlight="members" />

      {activeConference && (
        <section className="max-w-6xl mx-auto px-6 py-16">
          <SponsorshipLadder conferenceId={activeConference.id} />
        </section>
      )}

      <section className="py-24 md:py-32 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] tracking-tight mb-6">
            Ready to apply?
          </h2>
          <Link
            href="/apply/partner"
            className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
          >
            Apply for Partnership
          </Link>
        </div>
      </section>
    </div>
  );
}
