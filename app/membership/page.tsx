import type { Metadata } from "next";
import Link from "next/link";
import ValueProps from "@/components/home/ValueProps";
import LogoCarousel from "@/components/home/LogoCarousel";
import MembershipPricingTable from "@/components/membership/MembershipPricingTable";
import RenewalTerms from "@/components/pricing/RenewalTerms";
import { getSiteContent } from "@/lib/data";
import { getBillingConfig, getRenewalConfig } from "@/lib/policy/engine";
import { getMembersPageData } from "@/lib/homepage";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Membership | Campus Stores Canada",
  description:
    "What joining Campus Stores Canada as a member institution means — community, advocacy, and data built for campus retail.",
};

export default async function MembershipPage() {
  const [valuePropsHeader, valuePropsCards, billing, renewal, { mapOrgs }] = await Promise.all([
    getSiteContent("home_value_props_header"),
    getSiteContent("home_value_props"),
    getBillingConfig(),
    getRenewalConfig(),
    getMembersPageData(),
  ]);

  return (
    <div>
      <section className="py-20 md:py-28 bg-[#FAFAFA]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-4xl md:text-6xl font-bold text-[#1A1A1A] tracking-tight">
                Join the network built for campus retail.
              </h1>
              <p className="mt-6 text-xl text-[#6B6B6B] leading-relaxed">
                CSC membership is open to institutionally owned university, college, polytechnic,
                and CEGEP bookstores — and other campus retail operations — across Canada. It means
                a year-round peer community, benchmarking data you can&apos;t get anywhere else, and
                support if you ever consider bringing your operation back in-house — plus curated
                partner meetings and a share of the travel bursary at our annual conference.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/apply/member"
                  className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
                >
                  Apply for Membership
                </Link>
                <Link
                  href="/members"
                  className="h-14 px-8 bg-white hover:bg-slate-50 text-[#1A1A1A] text-lg font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] inline-flex items-center justify-center"
                >
                  Browse member institutions
                </Link>
              </div>
            </div>

            <div className="w-full max-w-md lg:shrink-0">
              <MembershipPricingTable
                pricingMode={billing.pricing_mode}
                membershipTiers={billing.membership_tiers}
                formulaConfig={billing.formula_config}
                prorationRules={billing.proration_rules}
              />
              <RenewalTerms cycleStartMonthDay={renewal.cycle_start_month_day} />
            </div>
          </div>
        </div>
      </section>

      <LogoCarousel members={mapOrgs} partners={[]} show="members" />

      <ValueProps header={valuePropsHeader[0] ?? null} cards={valuePropsCards} />

      <section className="py-24 md:py-32 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] tracking-tight mb-6">
            Ready to apply?
          </h2>
          <p className="text-lg text-[#6B6B6B] mb-10">
            Membership applications are reviewed by the CSC board — we&apos;ll follow up with next
            steps once yours is in.
          </p>
          <Link
            href="/apply/member"
            className="h-14 px-8 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-lg font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 inline-flex items-center justify-center"
          >
            Apply for Membership
          </Link>
        </div>
      </section>
    </div>
  );
}
