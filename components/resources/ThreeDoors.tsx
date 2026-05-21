import Link from "next/link";

export interface ThreeDoorsProps {
  isLoggedIn: boolean;
  /** "Member" | "Vendor Partner" | null (public) */
  userOrgType: string | null;
  userOrgSlug: string | null;
  hasSubmission: boolean;
  activeSurvey: { fiscal_year: number } | null;
}

export default function ThreeDoors({
  isLoggedIn,
  userOrgType,
  userOrgSlug,
  hasSubmission,
  activeSurvey,
}: ThreeDoorsProps) {
  const isMember  = isLoggedIn && userOrgType === "Member";
  const isPartner = isLoggedIn && userOrgType === "Vendor Partner";

  return (
    <section className="py-16 md:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Door 1: Benchmarking & Peer Data ─────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-[#E5E5E5] overflow-hidden">
            <div className="bg-[#163D6D] px-6 pt-8 pb-6">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-1">Data & Benchmarking</p>
              <h2 className="text-xl font-bold text-white leading-snug">Know where you stand</h2>
            </div>

            <div className="flex flex-col flex-1 px-6 py-6 gap-5">
              <p className="text-[#6B6B6B] text-sm leading-relaxed">
                39 campus stores across Canada participate in CSC&rsquo;s annual benchmarking survey. Compare your sales, margins, staffing, and operations against institutions most like yours — filtered by type, mandate, and enrolment size.
              </p>

              <div className="space-y-2 text-sm text-[#1A1A1A]">
                {[
                  "Financial performance vs. peer group medians",
                  "Quartile ranking across key metrics",
                  "Closest structural peers identified",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#163D6D] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-2">
                <BenchmarkingCTA
                  isMember={isMember}
                  isPartner={isPartner}
                  isLoggedIn={isLoggedIn}
                  hasSubmission={hasSubmission}
                  activeSurvey={activeSurvey}
                  userOrgSlug={userOrgSlug}
                />
              </div>
            </div>
          </div>

          {/* ── Door 2: Partner Network ───────────────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-[#E5E5E5] overflow-hidden">
            <div className="bg-[#2D2D2D] px-6 pt-8 pb-6">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-1">Vendor Partners</p>
              <h2 className="text-xl font-bold text-white leading-snug">
                {isMember ? "Who supplies the sector" : "Reach the market"}
              </h2>
            </div>

            <div className="flex flex-col flex-1 px-6 py-6 gap-5">
              {isMember ? (
                <>
                  <p className="text-[#6B6B6B] text-sm leading-relaxed">
                    CSC&rsquo;s vendor partner network includes the suppliers, distributors, and technology providers that campus stores rely on. Browse the full directory to find partners, compare options, and discover new vendors.
                  </p>
                  <div className="space-y-2 text-sm text-[#1A1A1A]">
                    {[
                      "Course materials suppliers and distributors",
                      "POS, ecommerce, and technology partners",
                      "Apparel, merchandise, and specialty vendors",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2D2D2D] flex-shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-2">
                    <Link
                      href="/partners"
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                    >
                      Browse Partners
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </Link>
                  </div>
                </>
              ) : isPartner ? (
                <>
                  <p className="text-[#6B6B6B] text-sm leading-relaxed">
                    Manage your CSC partnership, update your profile, access member contact information, and track your engagement with the network.
                  </p>
                  <div className="mt-auto pt-2">
                    <Link
                      href={userOrgSlug ? `/org/${userOrgSlug}` : "/toolkit"}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                    >
                      Your Partner Toolkit
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[#6B6B6B] text-sm leading-relaxed">
                    CSC connects vendors and suppliers directly with the decision-makers at campus stores across Canada. Partnership means more than a directory listing — it means a real relationship with the people who buy.
                  </p>
                  <div className="space-y-2 text-sm text-[#1A1A1A]">
                    {[
                      "Direct access to store managers and buyers",
                      "Annual conference exhibition and sponsorship",
                      "Targeted visibility in the member community",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2D2D2D] flex-shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-2">
                    <Link
                      href="/about#partner"
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                    >
                      Become a Partner
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Door 3: Independence Defense ─────────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-[#E5E5E5] overflow-hidden">
            <div className="bg-[#EE2A2E] px-6 pt-8 pb-6">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-1">Independence Defense</p>
              <h2 className="text-xl font-bold text-white leading-snug">Is your store under threat?</h2>
            </div>

            <div className="flex flex-col flex-1 px-6 py-6 gap-5">
              <p className="text-[#6B6B6B] text-sm leading-relaxed">
                When campus stores face outsourcing proposals or governance challenges, the CSC Independence Defense Network connects you with peers who have navigated the same pressure — and with data that makes the case for staying independent.
              </p>

              <div className="space-y-2 text-sm text-[#1A1A1A]">
                {[
                  "Peer consultation from stores that have been through it",
                  "Benchmarking data as evidence for your business case",
                  "Confidential — your situation stays private",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#EE2A2E] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-2 space-y-2">
                <Link
                  href="/contact?subject=independence-defense"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-full transition-colors"
                >
                  Get Confidential Support
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
                <p className="text-xs text-gray-400">No membership required to reach out.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

// ── Benchmarking CTA — handles all member states ──────────────────────────────

function BenchmarkingCTA({
  isMember,
  isPartner,
  isLoggedIn,
  hasSubmission,
  activeSurvey,
  userOrgSlug,
}: {
  isMember: boolean;
  isPartner: boolean;
  isLoggedIn: boolean;
  hasSubmission: boolean;
  activeSurvey: { fiscal_year: number } | null;
  userOrgSlug: string | null;
}) {
  // Member with a submission → go to their report
  if (isMember && hasSubmission && userOrgSlug) {
    return (
      <Link
        href={`/org/${userOrgSlug}`}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#163D6D] hover:bg-[#0f2d52] text-white text-sm font-semibold rounded-full transition-colors"
      >
        View Your Report
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
    );
  }

  // Member, no submission, survey open → take the survey
  if (isMember && !hasSubmission && activeSurvey) {
    return (
      <div className="space-y-2">
        <Link
          href="/benchmarking/survey"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#163D6D] hover:bg-[#0f2d52] text-white text-sm font-semibold rounded-full transition-colors"
        >
          Complete the {activeSurvey.fiscal_year} Survey
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
        <p className="text-xs text-gray-400">
          Your report becomes available once you submit.
        </p>
      </div>
    );
  }

  // Member, no submission, no open survey → dead end, we'll notify you
  if (isMember && !hasSubmission && !activeSurvey) {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-sm font-medium text-gray-700">Survey not currently open</p>
        <p className="text-xs text-gray-500 mt-0.5">
          We&rsquo;ll notify you when the next survey opens. Participation unlocks your full peer report.
        </p>
      </div>
    );
  }

  // Partner → can browse the aggregate (no personal report)
  if (isPartner) {
    return (
      <Link
        href="/benchmarking"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#163D6D] hover:bg-[#0f2d52] text-white text-sm font-semibold rounded-full transition-colors"
      >
        View Sector Overview
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
    );
  }

  // Not logged in → pitch to join
  return (
    <div className="space-y-2">
      <Link
        href="/about#membership"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#163D6D] hover:bg-[#0f2d52] text-white text-sm font-semibold rounded-full transition-colors"
      >
        Join to Access Your Report
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
      <p className="text-xs text-gray-400">
        Already a member?{" "}
        <Link href="/login" className="text-[#163D6D] hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
